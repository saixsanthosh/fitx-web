/**
 * Sprint start → acceleration → max-velocity running (main thread). OWNER: motion agent.
 *
 * Story beat: Maya in a crouched standing start, RIGHT foot forward with its toe on the start
 * line (z = 0 in model space), heel lifting from t = −0.3, push-off at t = 0. She drives out
 * with a big forward lean that rises over the first ~12 steps (6 strides) while speed follows
 * v(t) = vmax·(1 − e^(−t/τ)) (≈ 7.5 m/s at 2.5 s) and cadence rises to ≈ 4.6 steps/s.
 *
 * Everything is a pure function of action time t: the footstep plan is derived once per rig
 * and options, legs come from `gait.ts` (planted feet never slide), the pelvis/trunk/arms/head
 * are closed-form functions of the step phase.
 */

import * as THREE from "three";
import type { Rig } from "../rig/three-rig";
import { DEG, clamp01, lerp } from "../math";
import { PoseContext, quatXYZ, ramp, rigMetrics, spline, updateHelperBones, type RigMetrics } from "./helpers";
import type { FootRoll, Side } from "./foot";
import { gaitThighAngle, newLegState, solveGaitLeg, type GaitModel, type GaitStep, type LegState, type SwingShape } from "./gait";
import { poseArmSwing, stabiliseHead, type ArmSwing } from "./upper";
import type { HandPoses } from "./hands";

export interface SprintOptions {
  /** Asymptotic speed in m/s (default 7.75 → ≈ 7.5 m/s at 2.5 s). */
  topSpeed?: number;
  /** Acceleration time constant in seconds (default 0.65). */
  accelTime?: number;
}

export interface FootContactState {
  planted: boolean;
  /** Model-space floor point the foot pivots on (NaN while airborne). */
  position: THREE.Vector3;
  /** Current (planted) or last (airborne) step's touchdown / toe-off times. -Infinity = set foot. */
  touchdown: number;
  toeOff: number;
  step: number;
}

export interface SprintResult {
  /** COM travel along +Z since the set position (m). Root z = startZ + distance. */
  distance: number;
  /** Forward speed (m/s). */
  speed: number;
  footContacts: { L: FootContactState; R: FootContactState };
  /** Continuous step phase (integer at each touchdown; 0 in the set). */
  phase: number;
  /** Trunk lean from vertical (rad). */
  lean: number;
  /** Hand mesh poses (fists throughout). */
  hands: HandPoses;
}

export interface Footfall {
  side: Side;
  step: number;
  touchdown: number;
  toeOff: number;
  /** Model-space floor point under the ball of the foot. */
  position: THREE.Vector3;
}

type Mode = { kind: "sprint"; vmax: number; tau: number } | { kind: "run"; speed: number };

const SET_LEAN = 50 * DEG;
const TOP_LEAN = 8 * DEG;
const ROCK_START = -0.3;

class SprintModel implements GaitModel {
  readonly metrics: RigMetrics;
  readonly steps: Record<Side, GaitStep[]> = { L: [], R: [] };
  readonly maxReach = 0.996;
  readonly pole = new THREE.Vector3(0.06, 0.3, 1);
  readonly all: GaitStep[] = [];
  /** Touchdown times by phase index: tds[0] = 0 (push start), tds[k] = touchdown of step k. */
  private readonly tds: number[] = [0];
  private readonly bobT: number[] = [];
  private readonly bobV: number[] = [];
  readonly scale: number;
  readonly z0: number;
  private readonly hipTop: number;
  private readonly hipSet: number;
  private readonly leanC: number;
  private readonly hipMidBind = new THREE.Vector3();
  private readonly hipOffset: Record<Side, THREE.Vector3>;

  constructor(rig: Rig, readonly mode: Mode) {
    const m = rigMetrics(rig);
    this.metrics = m;
    const L = m.leg;
    const k = L / 0.813; // Maya's leg is the reference the numbers were tuned on.
    this.scale = k;
    const H0 = (m.hipJoint.L.y + m.hipJoint.R.y) / 2;
    this.hipTop = 0.945 * H0;
    this.hipSet = 0.81 * H0;
    this.leanC = 0.15 * k;
    this.hipMidBind.addVectors(m.hipJoint.L, m.hipJoint.R).multiplyScalar(0.5);
    this.hipOffset = { L: m.hipJoint.L.clone().sub(m.hips), R: m.hipJoint.R.clone().sub(m.hips) };
    const footR = m.foot.R;

    if (mode.kind === "sprint") {
      // Set position: right toe tip 1 cm behind the line, left foot ~half a metre back.
      const tipAhead = footR.tipGround.z - footR.ballGround.z;
      const rGround = new THREE.Vector3(-0.095 * k, 0, -0.01 - tipAhead);
      const lGround = new THREE.Vector3(0.1 * k, 0, rGround.z - 0.6 * k);
      const hipZ = rGround.z - 0.14 * k;
      this.z0 = hipZ + this.leanC * Math.sin(SET_LEAN);
      const setL: GaitStep = { k: -1, side: "L", td: -Infinity, to: 0.07, ground: lGround, yaw: 0.06, drive: 1, intensity: 1 };
      const setR: GaitStep = { k: 0, side: "R", td: -Infinity, to: 0.33, ground: rGround, yaw: -0.05, drive: 1, intensity: 1 };
      this.push(setL);
      this.push(setR);
      let td = 0.36;
      for (let i = 1; i < 140; i += 1) {
        const drive = Math.exp(-(i - 1) / 3);
        const stepTime = 0.218 + (0.25 - 0.218) * Math.exp(-(i - 1) / 3);
        const contact = 0.105 + (0.17 - 0.105) * Math.exp(-(i - 1) / 3);
        const to = td + contact;
        const mid = (td + to) / 2;
        const side: Side = i % 2 === 1 ? "L" : "R";
        const sx = side === "L" ? 1 : -1;
        const ahead = lerp(-0.06, -0.1, drive) * k;
        const ground = new THREE.Vector3(sx * lerp(0.055, 0.1, drive) * k, 0, this.com(mid) + ahead);
        this.push({ k: i, side, td, to, ground, yaw: sx * 0.05, drive, intensity: 1 });
        this.tds.push(td);
        td += stepTime;
      }
    } else {
      const v = mode.speed;
      const intensity = clamp01((v - 3) / 4.75);
      const stepTime = 1 / (2.2 + 0.3 * v);
      const contact = THREE.MathUtils.clamp(0.105 + (7.75 - v) * 0.03, 0.105, 0.28);
      this.z0 = 0;
      for (let i = -40; i < 400; i += 1) {
        const td = i * stepTime;
        const to = td + contact;
        const side: Side = ((i % 2) + 2) % 2 === 1 ? "L" : "R";
        const sx = side === "L" ? 1 : -1;
        const ground = new THREE.Vector3(sx * lerp(0.055, 0.08, 1 - intensity) * k, 0, this.com((td + to) / 2) + 0.03 * k);
        const step: GaitStep = { k: i, side, td: i === -40 || i === -39 ? -Infinity : td, to, ground, yaw: sx * 0.05, drive: 0, intensity };
        this.push(step);
      }
    }
    // Pelvis bob keys: lowest at mid-stance, highest at mid-flight.
    for (let i = 0; i < this.all.length - 1; i += 1) {
      const s = this.all[i];
      const n = this.all[i + 1];
      if (!Number.isFinite(s.td) || (s.k < 1 && mode.kind === "sprint")) continue;
      this.bobT.push((s.td + s.to) / 2, (s.to + n.td) / 2);
      this.bobV.push(-1, 1);
    }
  }

  private push(step: GaitStep) {
    this.all.push(step);
    this.steps[step.side].push(step);
  }

  /** COM forward travel since the set (m). */
  distance(t: number) {
    if (this.mode.kind === "run") return this.mode.speed * t;
    if (t <= 0) return 0.03 * this.scale * ramp(ROCK_START, 0, t);
    const { vmax, tau } = this.mode;
    return 0.03 * this.scale + vmax * (t - tau * (1 - Math.exp(-t / tau)));
  }

  com(t: number) {
    return this.z0 + this.distance(t);
  }

  speed(t: number) {
    if (this.mode.kind === "run") return this.mode.speed;
    if (t <= 0) return 0;
    return this.mode.vmax * (1 - Math.exp(-t / this.mode.tau));
  }

  /** Continuous step phase: integer at each touchdown. */
  phase(t: number) {
    if (this.mode.kind === "run") {
      const st = this.all[41].td - this.all[40].td;
      return t / st;
    }
    if (t <= 0) return 0;
    const tds = this.tds;
    let lo = 0;
    let hi = tds.length - 1;
    if (t >= tds[hi]) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tds[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - tds[lo]) / (tds[lo + 1] - tds[lo]);
  }

  /** Drive-phase amount (1 at the start, → 0 at max velocity). */
  drive(phi: number) {
    if (this.mode.kind === "run") return 0;
    return Math.exp(-Math.max(0, phi - 1) / 3);
  }

  lean(t: number, phi: number) {
    if (this.mode.kind === "run") return lerp(4 * DEG, TOP_LEAN, clamp01((this.mode.speed - 3) / 4.75));
    const set = SET_LEAN + 2 * DEG * ramp(ROCK_START, 0, t);
    if (t <= 0) return set;
    return TOP_LEAN + (set - TOP_LEAN) * Math.exp(-phi / 4.5);
  }

  private bob(t: number) {
    const T = this.bobT;
    if (T.length === 0 || t <= T[0]) return 0;
    let lo = 0;
    let hi = T.length - 1;
    if (t >= T[hi]) return this.bobV[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (T[mid] <= t) lo = mid;
      else hi = mid;
    }
    const u = (t - T[lo]) / (T[lo + 1] - T[lo]);
    const a = this.bobV[lo];
    const b = this.bobV[lo + 1];
    return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * u));
  }

  hipHeight(t: number, phi: number) {
    if (this.mode.kind === "run") {
      const intensity = clamp01((this.mode.speed - 3) / 4.75);
      const mean = lerp(0.935, 0.955, intensity) * (this.hipTop / 0.955);
      return mean + lerp(0.02, 0.028, intensity) * this.scale * this.bob(t);
    }
    const set = this.hipSet - 0.012 * this.scale * ramp(ROCK_START, 0, t);
    if (t <= 0) return set;
    const mean = this.hipTop - (this.hipTop - set) * Math.exp(-phi / 2.4);
    const amp = lerp(0.028, 0.012, this.drive(phi)) * this.scale;
    return mean + amp * this.bob(t) * ramp(0.3, 0.7, t);
  }

  /** Pelvis (hips bone) model-space pose. */
  pelvis(t: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
    const phi = this.phase(t);
    const lean = this.lean(t, phi);
    const drive = this.drive(phi);
    const sprint = this.mode.kind === "sprint";
    const yawAmp = sprint ? 0.15 - 0.07 * Math.exp(-phi / 2) : lerp(0.08, 0.15, clamp01((this.speed(t) - 3) / 4.75));
    const yaw = (t <= 0 && sprint ? 0.08 : yawAmp * Math.cos(Math.PI * phi));
    const settle = sprint ? ramp(0.2, 0.6, t) : 1;
    const roll = -0.05 * Math.cos(Math.PI * (phi - 0.25)) * settle;
    const sway = -0.012 * this.scale * Math.cos(Math.PI * (phi - 0.25)) * settle * (1 + 0.6 * drive);
    // The pelvis tilts with the whole trunk; spine/chest add a slight upper-back extension
    // so the hips → neck line matches `lean` (chest up).
    const pitch = lean + 0.06;
    quatXYZ(pitch, yaw, roll, outQuat);
    const mid = _mid.set(sway, this.hipHeight(t, phi), this.com(t) - this.leanC * Math.sin(lean));
    outPos.copy(this.hipMidBind).sub(this.metrics.hips).applyQuaternion(outQuat);
    outPos.subVectors(mid, outPos);
    return { phi, lean, drive, yaw, roll, pitch };
  }

  hipJoint(t: number, side: Side, out: THREE.Vector3) {
    this.pelvis(t, _pp, _pq);
    return out.copy(this.hipOffset[side]).applyQuaternion(_pq).add(_pp);
  }

  stanceRoll(step: GaitStep, t: number, out: FootRoll): FootRoll {
    out.heel = 0;
    out.tip = 0;
    if (this.mode.kind === "sprint" && step.k === 0) {
      // Front foot of the set: flat, heel lifts from −0.3, then the long first push.
      if (t <= 0) {
        out.ball = 0.32 * ramp(ROCK_START, 0, t);
      } else {
        const u = t / step.to;
        out.ball = spline([0, 0.45, 1], [0.32, 0.42, 1.15], u);
        out.tip = 0.36 * ramp(0.72, 1, u);
      }
      return out;
    }
    if (this.mode.kind === "sprint" && step.k === -1) {
      // Rear foot of the set: already on the ball, pushes briefly and leaves first.
      if (t <= 0) out.ball = 0.62 + 0.06 * ramp(ROCK_START, 0, t);
      else {
        const u = t / step.to;
        out.ball = lerp(0.68, 1.15, u);
        out.tip = 0.4 * ramp(0.35, 1, u);
      }
      return out;
    }
    const u = Number.isFinite(step.td) ? clamp01((t - step.td) / (step.to - step.td)) : 0.3;
    const d = step.drive;
    out.ball = spline([0, 0.3, 0.7, 1], [lerp(0.18, 0.28, d), lerp(0.05, 0.14, d), lerp(0.3, 0.4, d), lerp(1.05, 1.12, d)], u);
    out.tip = 0.32 * ramp(0.78, 1, u);
    return out;
  }

  swingShape(prev: GaitStep, next: GaitStep): SwingShape {
    // Blend between drive-phase recovery (low heel, piston-like knee drive) and max-velocity
    // recovery (heel tucks under the glutes, thigh to ~horizontal, active pawing touchdown).
    const d = this.mode.kind === "sprint" ? (prev.k <= 0 ? 1 : (prev.drive + next.drive) / 2) : 0;
    const i = prev.intensity;
    const first = this.mode.kind === "sprint" && prev.k === -1 ? 1 : 0;
    const mix = (top: number[], drive: number[], low: number[]) => top.map((v, n) => lerp(lerp(low[n], v, i), drive[n], d) * DEG);
    return {
      s: [0.2, 0.38, 0.56, 0.72, 0.86],
      thigh: mix([-8, 20, 52, 72, 54], [-18 + 6 * first, 6, 30, 46 - 4 * first, 34], [-12, 5, 28, 38, 30]),
      knee: mix([100, 132, 118, 88, 42], [70, 96 - 12 * first, 94, 76, 50], [60, 88, 80, 55, 25]),
      ankle: mix([6, -12, -16, -10, 0], [8, -6, -12, -10, -2], [4, -10, -12, -8, -4]),
      toeRelax: 0.28,
    };
  }
}

const _mid = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _pq = new THREE.Quaternion();

const models = new WeakMap<Rig, Map<string, SprintModel>>();

function modelFor(rig: Rig, mode: Mode) {
  let map = models.get(rig);
  if (!map) {
    map = new Map();
    models.set(rig, map);
  }
  const key = mode.kind === "sprint" ? `s${mode.vmax.toFixed(3)}:${mode.tau.toFixed(3)}` : `r${mode.speed.toFixed(3)}`;
  let model = map.get(key);
  if (!model) {
    model = new SprintModel(rig, mode);
    map.set(key, model);
  }
  return model;
}

function sprintMode(opts?: SprintOptions): Mode {
  return { kind: "sprint", vmax: opts?.topSpeed ?? 7.75, tau: opts?.accelTime ?? 0.65 };
}

const ctx = new PoseContext();
const legs = { L: newLegState("L"), R: newLegState("R") };
const scratch = newLegState("L");
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _armL: ArmSwing = { flex: 0, elbow: 0, abduct: 0, across: 0 };
const _armR: ArmSwing = { flex: 0, elbow: 0, abduct: 0, across: 0 };

function contactState(leg: LegState): FootContactState {
  return {
    planted: leg.planted,
    position: leg.contact.clone(),
    touchdown: leg.step.td,
    toeOff: leg.step.to,
    step: leg.step.k,
  };
}

function poseGait(rig: Rig, model: SprintModel, t: number): SprintResult {
  rig.resetPose();
  ctx.begin(rig);
  const b = rig.bones;
  const sprint = model.mode.kind === "sprint";

  // Root carries the smooth COM progression; the hips bone carries bob/sway/lean offsets.
  const com = model.com(t);
  b.root.position.set(0, 0, com);
  const p = model.pelvis(t, _pos, _q);
  b.hips.position.copy(_pos).sub(b.root.position);
  b.hips.quaternion.copy(_q);

  // Trunk: lean split over the spine, counter-rotation of the thorax against the pelvis.
  const lean = p.lean;
  quatXYZ(-0.06, -0.8 * p.yaw, -0.6 * p.roll, b.spine.quaternion);
  quatXYZ(-0.035, -0.75 * p.yaw, -0.4 * p.roll, b.chest.quaternion);

  // Legs.
  for (const side of ["L", "R"] as const) {
    const leg = solveGaitLeg(model, t, side, legs[side]);
    ctx.ik(`leg_${side}`, leg.ankle, leg.pole, { maxExtension: 0.9995 }, leg.foot);
    // Toe bone: local = foot⁻¹ · toe (both model space).
    ctx.boneQuat(`foot_${side}`, _q);
    b[`toe_${side}`].quaternion.copy(_q.invert().multiply(leg.toe));
  }

  // Arms are phased off the legs (slightly leading) so the start transition stays in sync.
  const lead = 0.02;
  const thighL = gaitThighAngle(model, t + lead, "L", scratch);
  const thighR = gaitThighAngle(model, t + lead, "R", scratch);
  const S = (thighR - thighL) / 2; // + when the right knee is forward → left arm forward
  const drive = p.drive;
  const gain = 1.3 + 0.25 * drive;
  const setBlend = sprint ? 1 - ramp(-0.02, 0.14, t) : 0;
  // Arm angles are authored relative to the vertical (what reads on screen) and converted to
  // the leaning chest frame: in the drive phase the swing stays centred near the vertical.
  // Chest world pitch = pelvis (lean + 0.06) + spine (−0.06) + chest (−0.035).
  const chestPitch = lean - 0.035;
  const armFor = (signal: number, out: ArmSwing, setFlex: number, setElbow: number) => {
    // Hand rises to about chin height in front (elbow closed ~80°) and passes the hip
    // behind (elbow opening to ~110°); elbows stay close, the front hand drifts to the midline.
    let flex = THREE.MathUtils.clamp(gain * signal - 0.04, -1.1, 1.0);
    flex = lerp(flex, setFlex, setBlend);
    out.flex = flex + chestPitch;
    out.elbow = lerp(1.66 - 0.3 * THREE.MathUtils.clamp(flex, -1, 1), setElbow, setBlend);
    out.abduct = 0.05 - 0.07 * Math.max(0, flex) + 0.13 * Math.max(0, -flex);
    out.across = 0.55 * Math.max(0, Math.sin(flex));
    return out;
  };
  armFor(S, _armL, 0.62, 1.62);
  armFor(-S, _armR, -1.0, 1.62);
  poseArmSwing(ctx, rig, "L", _armL, 0.1);
  poseArmSwing(ctx, rig, "R", _armR, 0.1);

  // Head: stabilised in model space, gaze lifting with the trunk.
  const gaze = sprint ? lerp(0.82 * lean, 0.55 * lean + 0.1, ramp(-0.05, 0.4, t)) : 0.55 * lean + 0.1;
  stabiliseHead(ctx, rig, gaze, 0, 0.45);

  updateHelperBones(rig);
  return {
    distance: model.distance(t),
    speed: model.speed(t),
    footContacts: { L: contactState(legs.L), R: contactState(legs.R) },
    phase: p.phi,
    lean,
    hands: { L: "fist", R: "fist" },
  };
}

/**
 * Poses a sprint start and acceleration at action time `t` (s). t < 0 holds the set (right
 * toe tip 1 cm behind z = 0, left foot 0.6 m back); the right heel lifts and the body rocks
 * forward from t = −0.3; t = 0 is push-off. Root z = sprintStartZ (≈ −0.09 m for Maya) +
 * distance; the root follows the centre of mass, the hips bone carries bob/sway/lean.
 */
export function poseSprint(rig: Rig, t: number, opts?: SprintOptions): SprintResult {
  return poseGait(rig, modelFor(rig, sprintMode(opts)), t);
}

/** Steady running at `speed` m/s (no start). Root z = speed · t. */
export function poseRun(rig: Rig, t: number, speed: number): SprintResult {
  return poseGait(rig, modelFor(rig, { kind: "run", speed }), t);
}

/** Every footstep of the sprint (for grit kicks, footprints, camera beats). */
export function sprintFootfalls(rig: Rig, opts?: SprintOptions, until = 12): Footfall[] {
  const model = modelFor(rig, sprintMode(opts));
  return model.all
    .filter((s) => s.to <= until)
    .map((s) => ({ side: s.side, step: s.k, touchdown: s.td, toeOff: s.to, position: s.ground.clone() }));
}

/** Model-space z of the root (COM) in the set position. */
export function sprintStartZ(rig: Rig, opts?: SprintOptions) {
  return modelFor(rig, sprintMode(opts)).com(-1);
}
