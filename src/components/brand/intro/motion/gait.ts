/**
 * Footstep-driven gait engine shared by the sprint, run and walk drivers. OWNER: motion agent.
 *
 * A gait is a list of footsteps per side (touchdown time, toe-off time, floor position,
 * heading). Each leg is solved from that list as a pure function of time:
 * - STANCE: the shoe rolls about a fixed ground pivot (`plantFoot`), the ankle target comes
 *   from the pivot, so the contact never slides; leg IK does the rest.
 * - SWING: thigh angle, knee flexion and ankle angle follow Hermite curves through
 *   style-specific keys. Their end values *and time derivatives* are taken from the stance
 *   solutions at toe-off and touchdown, so the leg leaves and meets the ground without pops
 *   and the foot arrives with (near) zero world velocity.
 */

import * as THREE from "three";
import type { RigMetrics } from "./helpers";
import { hermite } from "./helpers";
import { newFootSolution, plantFoot, type FootRoll, type FootSolution, type Side } from "./foot";

export interface GaitStep {
  /** Step index (sprint: -1 and 0 are the two feet of the set position). */
  k: number;
  side: Side;
  /** Touchdown time (s); -Infinity for a foot that starts planted. */
  td: number;
  /** Toe-off time (s). */
  to: number;
  /** Model-space floor point under the ball joint of the flat foot. */
  ground: THREE.Vector3;
  /** Foot heading (rad, + = toes towards the character's left). */
  yaw: number;
  /** Driver-defined style blends for this step (e.g. sprint drive phase 1 → max velocity 0). */
  drive: number;
  intensity: number;
}

export interface SwingShape {
  /** Interior key times in normalised swing time (ascending, inside (0, 1)). */
  s: readonly number[];
  /** Thigh angle from vertical-down (rad, + forward) at each interior key. */
  thigh: readonly number[];
  /** Knee flexion (rad) at each interior key. */
  knee: readonly number[];
  /** Ankle plantarflexion relative to "foot perpendicular to shin" (rad, + toes down). */
  ankle: readonly number[];
  /** Normalised swing time by which the toes return to neutral after toe-off. */
  toeRelax?: number;
}

export interface GaitModel {
  metrics: RigMetrics;
  steps: Record<Side, GaitStep[]>;
  /** Model-space hip joint (upperLeg bone) at time t — must match the pelvis the driver poses. */
  hipJoint(t: number, side: Side, out: THREE.Vector3): THREE.Vector3;
  /** Desired foot roll of a planted step at time t. */
  stanceRoll(step: GaitStep, t: number, out: FootRoll): FootRoll;
  swingShape(prev: GaitStep, next: GaitStep): SwingShape;
  /** Fraction of the full leg length the stance leg may extend to. */
  maxReach: number;
  /** Knee pole direction in the foot's heading frame (x lateral outward, y up, z forward). */
  pole?: THREE.Vector3;
}

export interface LegState {
  side: Side;
  planted: boolean;
  /** Stance step (planted) or the step the foot just left (swing). */
  step: GaitStep;
  /** Next step of this foot (swing only). */
  next: GaitStep | null;
  /** Normalised swing progress (0 when planted). */
  swing: number;
  /** Normalised stance progress (0..1; < 0 before the first touchdown of a set foot). */
  stance: number;
  ankle: THREE.Vector3;
  foot: THREE.Quaternion;
  toe: THREE.Quaternion;
  pole: THREE.Vector3;
  /** Sagittal thigh angle (rad, + forward) and knee flexion of the solved leg. */
  thigh: number;
  knee: number;
  /** Ground pivot (planted) in model space. */
  contact: THREE.Vector3;
}

export function newLegState(side: Side): LegState {
  return {
    side,
    planted: true,
    step: null as unknown as GaitStep,
    next: null,
    swing: 0,
    stance: 0,
    ankle: new THREE.Vector3(),
    foot: new THREE.Quaternion(),
    toe: new THREE.Quaternion(),
    pole: new THREE.Vector3(),
    thigh: 0,
    knee: 0,
    contact: new THREE.Vector3(),
  };
}

/** Sagittal two-link solve (z forward, y up) of the hip → ankle offset. */
export function legAngles(dz: number, dy: number, thigh: number, shin: number) {
  const reach = thigh + shin - 1e-6;
  const D = THREE.MathUtils.clamp(Math.hypot(dz, dy), Math.abs(thigh - shin) + 1e-6, reach);
  const gamma = Math.atan2(dz, -dy);
  const A = Math.acos(THREE.MathUtils.clamp((thigh * thigh + D * D - shin * shin) / (2 * thigh * D), -1, 1));
  const inner = Math.acos(THREE.MathUtils.clamp((thigh * thigh + shin * shin - D * D) / (2 * thigh * shin), -1, 1));
  return { thigh: gamma + A, knee: Math.PI - inner };
}

interface Boundary {
  thigh: number;
  knee: number;
  ankle: number;
  dThigh: number;
  dKnee: number;
  dAnkle: number;
  pos: THREE.Vector3;
  /** FK error (target − FK) in z/y at the boundary, faded across the swing. */
  corr: THREE.Vector3;
  yaw: number;
  toeLocal: number;
}

interface SwingCache {
  start: Boundary;
  end: Boundary;
  shape: SwingShape;
}

const swingCaches = new WeakMap<GaitModel, Map<string, SwingCache>>();

const _roll: FootRoll = { heel: 0, ball: 0, tip: 0 };
const _sol = newFootSolution();
const _hip = new THREE.Vector3();
const _hip2 = new THREE.Vector3();
const _yawQ = new THREE.Quaternion();
const _pitchQ = new THREE.Quaternion();
const _toeQ = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const DEFAULT_POLE = new THREE.Vector3(0.08, 0.35, 1);

function stanceSolve(model: GaitModel, step: GaitStep, t: number, out: FootSolution) {
  model.stanceRoll(step, t, _roll);
  model.hipJoint(t, step.side, _hip);
  const m = model.metrics;
  return plantFoot(m.foot[step.side], step.ground, step.yaw, _roll, out, { hip: _hip, maxReach: m.leg * model.maxReach });
}

function boundary(model: GaitModel, step: GaitStep, t: number, dtSign: number): Boundary {
  const m = model.metrics;
  const h = 1e-3;
  const sample = (time: number) => {
    stanceSolve(model, step, time, _sol);
    model.hipJoint(time, step.side, _hip2);
    const a = legAngles(_sol.ankle.z - _hip2.z, _sol.ankle.y - _hip2.y, m.thigh, m.shin);
    return { thigh: a.thigh, knee: a.knee, ankle: _sol.pitch - (a.knee - a.thigh), pos: _sol.ankle.clone(), toeLocal: _sol.toePitch - _sol.pitch, hipZ: _hip2.z, hipY: _hip2.y };
  };
  const s0 = sample(t);
  const s1 = sample(t + dtSign * h);
  const inv = dtSign / h;
  // FK of the boundary angles relative to the hip at that time, to measure the planar error.
  const fkz = s0.hipZ + m.thigh * Math.sin(s0.thigh) + m.shin * Math.sin(s0.thigh - s0.knee);
  const fky = s0.hipY - m.thigh * Math.cos(s0.thigh) - m.shin * Math.cos(s0.thigh - s0.knee);
  return {
    thigh: s0.thigh,
    knee: s0.knee,
    ankle: s0.ankle,
    dThigh: (s1.thigh - s0.thigh) * inv,
    dKnee: (s1.knee - s0.knee) * inv,
    dAnkle: (s1.ankle - s0.ankle) * inv,
    pos: s0.pos,
    corr: new THREE.Vector3(0, s0.pos.y - fky, s0.pos.z - fkz),
    yaw: step.yaw,
    toeLocal: s0.toeLocal,
  };
}

function swingCache(model: GaitModel, prev: GaitStep, next: GaitStep): SwingCache {
  let map = swingCaches.get(model);
  if (!map) {
    map = new Map();
    swingCaches.set(model, map);
  }
  const key = `${prev.side}${prev.k}`;
  let c = map.get(key);
  if (!c) {
    c = { start: boundary(model, prev, prev.to, -1), end: boundary(model, next, next.td, 1), shape: model.swingShape(prev, next) };
    map.set(key, c);
  }
  return c;
}

/** Hermite curve through [0, ...keys, 1] with given end values/derivatives (per unit s). */
function curve(s: number, v0: number, d0: number, xs: readonly number[], ys: readonly number[], v1: number, d1: number) {
  const n = xs.length;
  const X = (i: number) => (i === 0 ? 0 : i === n + 1 ? 1 : xs[i - 1]);
  const Y = (i: number) => (i === 0 ? v0 : i === n + 1 ? v1 : ys[i - 1]);
  let i = 0;
  while (i < n && s > X(i + 1)) i += 1;
  const x0 = X(i);
  const x1 = X(i + 1);
  const span = x1 - x0;
  const tangent = (j: number) => {
    if (j === 0) return d0;
    if (j === n + 1) return d1;
    return (Y(j + 1) - Y(j - 1)) / (X(j + 1) - X(j - 1));
  };
  return hermite(Y(i), tangent(i) * span, Y(i + 1), tangent(i + 1) * span, span > 0 ? (s - x0) / span : 0);
}

/** Index of the last step with td <= t (steps sorted by td); -1 if none. */
function lastStepAt(steps: GaitStep[], t: number) {
  let lo = 0;
  let hi = steps.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].td <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

const smoother = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Solves one leg of a gait at time t (model space). */
export function solveGaitLeg(model: GaitModel, t: number, side: Side, out: LegState): LegState {
  const steps = model.steps[side];
  const m = model.metrics;
  let j = lastStepAt(steps, t);
  if (j < 0) j = 0;
  const step = steps[j];
  const nextStep = j + 1 < steps.length ? steps[j + 1] : null;
  const sx = side === "L" ? 1 : -1;
  const pole = model.pole ?? DEFAULT_POLE;
  out.side = side;
  out.step = step;

  if (t <= step.to || !nextStep) {
    stanceSolve(model, step, t, _sol);
    out.planted = true;
    out.next = nextStep;
    out.swing = 0;
    out.stance = Number.isFinite(step.td) ? (t - step.td) / (step.to - step.td) : t < 0 ? -1 : t / step.to;
    out.ankle.copy(_sol.ankle);
    out.foot.copy(_sol.foot);
    out.toe.copy(_sol.toe);
    out.contact.copy(_sol.pivot);
    model.hipJoint(t, side, _hip);
    const a = legAngles(out.ankle.z - _hip.z, out.ankle.y - _hip.y, m.thigh, m.shin);
    out.thigh = a.thigh;
    out.knee = a.knee;
    _yawQ.setFromAxisAngle(AY, step.yaw);
    out.pole.set(pole.x * sx, pole.y, pole.z).applyQuaternion(_yawQ).multiplyScalar(2 * m.leg).add(_hip);
    return out;
  }

  // Swing from `step` (toe-off) to `nextStep` (touchdown).
  const c = swingCache(model, step, nextStep);
  const duration = nextStep.td - step.to;
  const s = THREE.MathUtils.clamp((t - step.to) / duration, 0, 1);
  const { start: b0, end: b1, shape } = c;
  const thigh = curve(s, b0.thigh, b0.dThigh * duration, shape.s, shape.thigh, b1.thigh, b1.dThigh * duration);
  const knee = curve(s, b0.knee, b0.dKnee * duration, shape.s, shape.knee, b1.knee, b1.dKnee * duration);
  const ankle = curve(s, b0.ankle, b0.dAnkle * duration, shape.s, shape.ankle, b1.ankle, b1.dAnkle * duration);
  model.hipJoint(t, side, _hip);
  const w = smoother(s);
  const fz = _hip.z + m.thigh * Math.sin(thigh) + m.shin * Math.sin(thigh - knee);
  const fy = _hip.y - m.thigh * Math.cos(thigh) - m.shin * Math.cos(thigh - knee);
  out.ankle.set(
    THREE.MathUtils.lerp(b0.pos.x, b1.pos.x, w),
    fy + THREE.MathUtils.lerp(b0.corr.y, b1.corr.y, w),
    fz + THREE.MathUtils.lerp(b0.corr.z, b1.corr.z, w),
  );
  const yaw = THREE.MathUtils.lerp(b0.yaw, b1.yaw, w);
  _yawQ.setFromAxisAngle(AY, yaw);
  _pitchQ.setFromAxisAngle(AX, knee - thigh + ankle);
  out.foot.copy(_yawQ).multiply(_pitchQ);
  // Toes spring back to neutral after toe-off, then pre-shape for the next contact.
  const relax = shape.toeRelax ?? 0.3;
  const toeLocal = s < 0.5 ? b0.toeLocal * (1 - smoother(s / relax)) : b1.toeLocal * smoother((s - 0.8) / 0.2);
  _toeQ.setFromAxisAngle(AX, toeLocal);
  out.toe.copy(out.foot).multiply(_toeQ);
  out.planted = false;
  out.next = nextStep;
  out.swing = s;
  out.stance = 0;
  out.thigh = thigh;
  out.knee = knee;
  out.contact.set(NaN, NaN, NaN);
  out.pole.set(pole.x * sx, pole.y, pole.z).applyQuaternion(_yawQ).multiplyScalar(2 * m.leg).add(_hip);
  return out;
}

/** Thigh angle only (cheap; used to phase the arms and pelvis off the legs). */
export function gaitThighAngle(model: GaitModel, t: number, side: Side, scratch: LegState) {
  return solveGaitLeg(model, t, side, scratch).thigh;
}
