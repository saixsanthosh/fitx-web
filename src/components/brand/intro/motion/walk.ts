/**
 * Confident team walk towards the camera (+Z) (main thread). OWNER: motion agent.
 *
 * Heel-strike gait on the shared footstep engine: heel contact → foot flat → heel rise →
 * toe-off, each phase rolling about a fixed ground pivot (no sliding). Character styles:
 * - maya: light and quick, narrow track, hips sway, free arm swing;
 * - leo: relaxed, helmet carried in the right hand at his side with a bent arm;
 * - dre: broad and heavy, wide track, shoulders roll, arms held off the lats.
 * Root z = speed · t (+ the start offset); the director places the group.
 */

import * as THREE from "three";
import type { Rig } from "../rig/three-rig";
import { DEG } from "../math";
import { PoseContext, quatXYZ, rigMetrics, spline, updateHelperBones, type RigMetrics } from "./helpers";
import type { FootRoll, Side } from "./foot";
import { gaitThighAngle, newLegState, solveGaitLeg, type GaitModel, type GaitStep, type SwingShape } from "./gait";
import { poseArmSwing, stabiliseHead, type ArmSwing } from "./upper";
import { gripOffset, type HandPoses } from "./hands";

/** Helmet held by its rim at the side: centre ~11 cm off the palm, crown along the thumb. */
const HELMET_HOLD = { along: 0.45, palm: 0.55 } as const;

export type WalkStyle = "maya" | "leo" | "dre";

export interface WalkOptions {
  /** Forward speed in m/s (default 1.45). */
  speed?: number;
  style: WalkStyle;
  carry?: "helmet";
  /** Gait phase offset in steps (0..2) so a squad does not march in lockstep. */
  phase?: number;
}

export interface WalkResult {
  distance: number;
  hands: HandPoses;
  /** World transform for the carried helmet (origin = helmet centre, +Y = its crown). */
  helmet: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null;
  footContacts: { L: boolean; R: boolean };
}

interface StyleSpec {
  stepLength: number;
  width: number;
  toeOut: number;
  bob: number;
  sway: number;
  pelvisYaw: number;
  pelvisRoll: number;
  chestYaw: number;
  chestRoll: number;
  lean: number;
  armGain: number;
  armBias: number;
  elbow: number;
  abduct: number;
  heel: number;
  gaze: number;
}

// Arm gains are sized for the team walk's 0.6× slow motion, where a natural swing reads as stiff:
// a confident, visible counter-swing (about ±20–25° at the shoulder).
const STYLES: Record<WalkStyle, StyleSpec> = {
  maya: { stepLength: 0.7, width: 0.055, toeOut: 0.08, bob: 0.022, sway: 0.022, pelvisYaw: 0.1, pelvisRoll: 0.07, chestYaw: 0.06, chestRoll: 0.02, lean: 0.03, armGain: 1.3, armBias: 0.02, elbow: 0.3, abduct: 0.1, heel: 0.3, gaze: 0.04 },
  leo: { stepLength: 0.7, width: 0.07, toeOut: 0.1, bob: 0.022, sway: 0.022, pelvisYaw: 0.08, pelvisRoll: 0.05, chestYaw: 0.06, chestRoll: 0.025, lean: 0.02, armGain: 1.1, armBias: 0.0, elbow: 0.28, abduct: 0.12, heel: 0.28, gaze: 0.05 },
  dre: { stepLength: 0.68, width: 0.1, toeOut: 0.16, bob: 0.024, sway: 0.032, pelvisYaw: 0.07, pelvisRoll: 0.045, chestYaw: 0.1, chestRoll: 0.05, lean: 0.0, armGain: 1.05, armBias: 0.03, elbow: 0.42, abduct: 0.24, heel: 0.26, gaze: 0.03 },
};

class WalkModel implements GaitModel {
  readonly metrics: RigMetrics;
  readonly steps: Record<Side, GaitStep[]> = { L: [], R: [] };
  readonly maxReach = 0.997;
  readonly pole = new THREE.Vector3(0.12, 0.2, 1);
  readonly cadence: number;
  readonly period: number;
  readonly contact: number;
  private readonly hipMid = new THREE.Vector3();
  private readonly hipOffset: Record<Side, THREE.Vector3>;

  constructor(rig: Rig, readonly speed: number, readonly style: StyleSpec, readonly phase: number) {
    const m = rigMetrics(rig);
    this.metrics = m;
    const k = m.height / 1.75;
    const stepLength = style.stepLength * (m.leg / (0.484 * 1.75)) * Math.min(1.15, Math.max(0.75, speed / 1.45) ** 0.5);
    this.cadence = speed / stepLength;
    this.period = 1 / this.cadence;
    this.contact = 1.24 * this.period;
    this.hipMid.addVectors(m.hipJoint.L, m.hipJoint.R).multiplyScalar(0.5);
    this.hipOffset = { L: m.hipJoint.L.clone().sub(m.hips), R: m.hipJoint.R.clone().sub(m.hips) };
    const ballAhead = m.foot.R.ball.z - m.foot.R.ankle.z;
    for (let i = -6; i < 160; i += 1) {
      const td = (i - phase) * this.period;
      const to = td + this.contact;
      const side: Side = ((i % 2) + 2) % 2 === 0 ? "R" : "L";
      const sx = side === "L" ? 1 : -1;
      const mid = (td + to) / 2;
      const ground = new THREE.Vector3(sx * style.width * k, 0, this.speed * mid + ballAhead + 0.02 * k);
      const first = i < -4;
      this.push({ k: i, side, td: first ? -Infinity : td, to, ground, yaw: sx * style.toeOut, drive: 0, intensity: 0 });
    }
  }

  private push(step: GaitStep) {
    this.steps[step.side].push(step);
  }

  /** Step phase: integer at each right-foot touchdown (even) / left (odd). */
  phaseAt(t: number) {
    return t * this.cadence + this.phase;
  }

  pelvis(t: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
    const s = this.style;
    const k = this.metrics.height / 1.75;
    const phi = this.phaseAt(t);
    const c = Math.cos(Math.PI * phi);
    // Double support spans φ ∈ [k, k + 0.24]: the pelvis is lowest there and highest at
    // mid single-support (k + 0.62), swaying over the stance foot.
    const bob = s.bob * k * Math.cos(2 * Math.PI * (phi - 0.62));
    const sway = -s.sway * k * Math.cos(Math.PI * (phi - 0.62));
    const yaw = s.pelvisYaw * c;
    const roll = -s.pelvisRoll * Math.cos(Math.PI * (phi - 0.62));
    quatXYZ(s.lean + 0.04, yaw, roll, outQuat);
    const H0 = this.hipMid.y;
    _mid.set(sway, H0 - 0.043 * k + bob, this.speed * t);
    outPos.copy(this.hipMid).sub(this.metrics.hips).applyQuaternion(outQuat);
    outPos.subVectors(_mid, outPos);
    return { yaw, roll, phi };
  }

  hipJoint(t: number, side: Side, out: THREE.Vector3) {
    this.pelvis(t, _pp, _pq);
    return out.copy(this.hipOffset[side]).applyQuaternion(_pq).add(_pp);
  }

  stanceRoll(step: GaitStep, t: number, out: FootRoll): FootRoll {
    const u = Number.isFinite(step.td) ? (t - step.td) / (step.to - step.td) : 0.3;
    out.heel = this.style.heel * Math.max(0, 1 - u / 0.14) ** 1.6;
    out.ball = u < 0.5 ? 0 : spline([0.5, 0.8, 1], [0, 0.35, 0.72], u);
    out.tip = u < 0.86 ? 0 : 0.3 * ((u - 0.86) / 0.14) ** 1.5;
    if (out.heel > 1e-6) {
      out.ball = 0;
      out.tip = 0;
    }
    return out;
  }

  swingShape(): SwingShape {
    return {
      s: [0.25, 0.5, 0.78],
      thigh: [-8 * DEG, 12 * DEG, 24 * DEG],
      knee: [52 * DEG, 60 * DEG, 22 * DEG],
      ankle: [6 * DEG, -6 * DEG, -10 * DEG],
      toeRelax: 0.3,
    };
  }
}

const _mid = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _pq = new THREE.Quaternion();

const models = new WeakMap<Rig, Map<string, WalkModel>>();

function modelFor(rig: Rig, speed: number, style: WalkStyle, phase: number) {
  let map = models.get(rig);
  if (!map) {
    map = new Map();
    models.set(rig, map);
  }
  const key = `${style}:${speed.toFixed(3)}:${phase.toFixed(3)}`;
  let model = map.get(key);
  if (!model) {
    model = new WalkModel(rig, speed, STYLES[style], phase);
    map.set(key, model);
  }
  return model;
}

const ctx = new PoseContext();
const legs = { L: newLegState("L"), R: newLegState("R") };
const scratch = newLegState("L");
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _arm: ArmSwing = { flex: 0, elbow: 0, abduct: 0, across: 0 };
const _hq = new THREE.Quaternion();
const _hp = new THREE.Vector3();
const _off = new THREE.Vector3();
const HELMET_FROM_HAND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

export function poseWalk(rig: Rig, t: number, opts: WalkOptions): WalkResult {
  const speed = opts.speed ?? 1.45;
  const model = modelFor(rig, speed, opts.style, opts.phase ?? 0);
  const s = model.style;
  rig.resetPose();
  ctx.begin(rig);
  const b = rig.bones;

  b.root.position.set(0, 0, 0);
  const p = model.pelvis(t, _pos, _q);
  b.hips.position.copy(_pos);
  b.hips.quaternion.copy(_q);
  // Thorax counter-rotates; Dre's shoulders roll with each step.
  const step = Math.cos(Math.PI * (p.phi - 0.62));
  quatXYZ(-0.03, -0.6 * p.yaw - 0.5 * s.chestYaw * Math.cos(Math.PI * p.phi), -0.5 * p.roll, b.spine.quaternion);
  quatXYZ(-0.04 + 0.01 * Math.cos(2 * Math.PI * p.phi), -0.5 * p.yaw - 0.5 * s.chestYaw * Math.cos(Math.PI * p.phi), -0.4 * p.roll + s.chestRoll * step, b.chest.quaternion);

  for (const side of ["L", "R"] as const) {
    const leg = solveGaitLeg(model, t, side, legs[side]);
    ctx.ik(`leg_${side}`, leg.ankle, leg.pole, { maxExtension: 0.9995 }, leg.foot);
    ctx.boneQuat(`foot_${side}`, _q);
    b[`toe_${side}`].quaternion.copy(_q.invert().multiply(leg.toe));
  }

  // Arms swing against the legs (slight lead).
  const thighL = gaitThighAngle(model, t + 0.03, "L", scratch);
  const thighR = gaitThighAngle(model, t + 0.03, "R", scratch);
  const S = (thighR - thighL) / 2;
  const hands: HandPoses = { L: "relaxed", R: "relaxed" };
  let helmet: WalkResult["helmet"] = null;
  for (const side of ["L", "R"] as const) {
    const sig = side === "L" ? S : -S;
    if (opts.carry === "helmet" && side === "R") {
      // Helmet at his side: upper arm slightly back, elbow bent, a little swing.
      _arm.flex = -0.12 + 0.12 * sig;
      _arm.elbow = 1.15 + 0.05 * sig;
      _arm.abduct = 0.2;
      _arm.across = 0.1;
      poseArmSwing(ctx, rig, side, _arm, 0.05);
      hands.R = "grip";
      continue;
    }
    _arm.flex = s.armGain * sig + s.armBias;
    _arm.elbow = s.elbow + 0.25 * Math.max(0, _arm.flex);
    _arm.abduct = s.abduct;
    _arm.across = 0.12 * Math.max(0, _arm.flex);
    poseArmSwing(ctx, rig, side, _arm, 0.08);
  }

  stabiliseHead(ctx, rig, s.gaze, 0, 0.5);
  updateHelperBones(rig);

  if (opts.carry === "helmet") {
    ctx.boneQuat("hand_R", _hq);
    ctx.bonePos("hand_R", _hp);
    gripOffset(rig, "R", _hq, HELMET_HOLD, _off);
    _hp.add(_off);
    _hq.multiply(HELMET_FROM_HAND);
    helmet = { position: ctx.toWorld(_hp, new THREE.Vector3()), quaternion: ctx.quatToWorld(_hq, new THREE.Quaternion()) };
  }
  return { distance: speed * t, hands, helmet, footContacts: { L: legs.L.planted, R: legs.R.planted } };
}
