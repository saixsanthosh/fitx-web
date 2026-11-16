/**
 * Chalk clap + conventional deadlift (main thread). OWNER: motion agent.
 *
 * Frame: the character group stands at the platform surface centre facing +Z; the bar runs
 * along X in front of the shins, over mid-foot. Action timeline (s):
 *   0.00–0.55 chalk clap (palms meet ≈0.25, rub, part)
 *   0.55–0.90 step in to the bar, 0.85–1.12 hip hinge and grip
 *   1.12–1.42 wedge: the hips sink while the slack comes out of the bar — it bows over plates
 *             that are still on the platform (its centre rises with the bend)
 *   1.42–2.20 pull: lift-off 1.42 at full bow, quick off the floor, a grind with a tremor through
 *             the knee, then the hips drive through to lockout 2.2
 *   2.20–2.27 hold, chest up; then the hands open and the bar drops (pushed a touch forward), the
 *             plates land at 2.57 and bounce twice while the lifter exhales and watches it
 * While the hands hold the bar the pelvis pitch is SOLVED every frame so the (straight) arms
 * reach the grip exactly; the hip path is keyed by bar height so hips and shoulders rise
 * together off the floor and the hips drive through at the top.
 */

import * as THREE from "three";
import { BARBELL } from "../dimensions";
import type { Rig } from "../rig/three-rig";
import { lerp, smoothstep, smootherstep01 } from "../math";
import { PoseContext, bump, quatXYZ, ramp, rigMetrics, spline, updateHelperBones, type RigMetrics } from "./helpers";
import { GRIP_BAR, gripOffset, handBindFrame, handRotation, type HandPoses } from "./hands";
import { flatAnkle, type Side } from "./foot";
import { armSwingTarget, setShoulderGirdle, stabiliseHead, type ArmSwing } from "./upper";

export interface LiftEvents {
  clapTime: number;
  liftOffTime: number;
  lockoutTime: number;
  dropTime: number;
}

export interface LiftResult {
  /** Bar centre in model space (x = 0). */
  bar: { y: number; z: number };
  /**
   * -1..1 bar bend: > 0 the sleeves droop (loaded: full bow at lift-off), < 0 the centre whips
   * below the plates when they land. While the plates are on the platform `bar.y` already includes
   * the centre's rise/dip for this bend, so the plates stay on the floor.
   */
  barBend: number;
  /** 0..1 clap intensity, peaks at `events.clapTime` (drive the chalk burst with it). */
  clap: number;
  events: LiftEvents;
  hands: HandPoses;
  /** True while the hands hold the bar. */
  gripping: boolean;
}

export const LIFT_EVENTS: LiftEvents = { clapTime: 0.25, liftOffTime: 1.42, lockoutTime: 2.2, dropTime: 2.57 };

const T_STEP0 = 0.55;
const T_HINGE0 = 0.85;
const T_GRIP = 1.12;
/** End of the wedge (hips sunk into the setup). */
const T_BRACE = 1.36;
/** The bow starts building (slack coming out of the bar). */
const T_SLACK0 = 1.28;
const APPROACH = 0.3;
const GRAVITY = 9.81;
/** The hands push the bar away and down a little as they open (m/s). */
const RELEASE_SPEED = 0.45;
/** Forward drift of the dropped bar (clears the knees). */
const RELEASE_PUSH = 0.045;

/**
 * Bar bend geometry, mirroring the barbell prop (`sets/props/barbell.ts`): the shaft outside the
 * grip deflects quadratically to BAR_END_DIP at the sleeve end for bend 1, and each sleeve (with its
 * plates) tilts rigidly with the shaft at the inner collar.
 */
const BAR_END_DIP = 0.1;
/** Drop of a plate centre (at |x| = u along the bar) below the bar centre for bend 1. */
function plateDrop(u: number) {
  const g = BARBELL.gripHalfWidth;
  const span = BARBELL.length / 2 - g;
  const pivot = BARBELL.sleeveStart;
  return BAR_END_DIP * ((pivot - g) / span) ** 2 + ((2 * BAR_END_DIP * (pivot - g)) / (span * span)) * (u - pivot);
}
const PLATE_CENTRES = (() => {
  const out: number[] = [];
  let x = BARBELL.sleeveStart + 0.002;
  for (const plate of BARBELL.plates) {
    out.push(x + plate.thickness / 2);
    x += plate.thickness + 0.0015;
  }
  return out;
})();
/** Bow (> 0): the outermost 20 kg plate stays on the floor (the thin 10 kg outside it sinks < 1 cm at full bow). */
const RISE_BOW = plateDrop(PLATE_CENTRES[PLATE_CENTRES.length - 2]);
/** Whip (< 0): the centre dips until the innermost plate would leave the floor. */
const RISE_WHIP = plateDrop(PLATE_CENTRES[0]);
/** Bar-centre offset above its rest height that keeps the plates on the platform for a bend. */
const groundedRise = (bend: number) => (bend >= 0 ? RISE_BOW : RISE_WHIP) * bend;

/** Monotone cubic (Fritsch–Carlson) through fixed keys: no overshoot, so the bar never sinks back. */
function monotoneCurve(xs: readonly number[], ys: readonly number[]) {
  const n = xs.length;
  const d = xs.slice(0, -1).map((x, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - x));
  const m = xs.map((_, i) => (i === 0 || i === n - 1 ? 0 : d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])));
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i += 1;
    const h = xs[i + 1] - xs[i];
    const s = (x - xs[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}

/**
 * Share of the travel from the break to lockout (u = share of the pull's duration). A heavy single:
 * the plates creep off the floor, the bar runs to just under the knee, grinds through it (the
 * sticking point) and the hips drive it home.
 */
const PULL = monotoneCurve([0, 0.1, 0.34, 0.62, 0.86, 1], [0, 0.04, 0.37, 0.55, 0.92, 1]);
/** Where the grind sits in u (tremor window). */
const GRIND = [0.3, 0.4, 0.62, 0.72] as const;

/** Bumper bounces after the drop: contact, rebound flight (5 cm), contact, flight (1 cm). */
const BOUNCE = (() => {
  const v1 = Math.sqrt(2 * GRAVITY * 0.05);
  const v2 = Math.sqrt(2 * GRAVITY * 0.01);
  const c1 = 0.032;
  const f1 = (2 * v1) / GRAVITY;
  const c2 = 0.022;
  const f2 = (2 * v2) / GRAVITY;
  return { v1, v2, c1, f1, c2, f2 };
})();

/** Height of the bouncing bar above rest, `tau` s after the plates first touch down. */
function bounceAt(tau: number) {
  const { v1, v2, c1, f1, c2, f2 } = BOUNCE;
  if (tau < c1) return -0.006 * Math.sin((Math.PI * tau) / c1);
  let u = tau - c1;
  if (u < f1) return v1 * u - 0.5 * GRAVITY * u * u;
  u -= f1;
  if (u < c2) return -0.003 * Math.sin((Math.PI * u) / c2);
  u -= c2;
  if (u < f2) return v2 * u - 0.5 * GRAVITY * u * u;
  return 0;
}

interface LiftSetup {
  m: RigMetrics;
  k: number;
  zBar: number;
  ground: Record<Side, THREE.Vector3>;
  yaw: Record<Side, number>;
  yLock: number;
  reach: number;
  hipMidBind: THREE.Vector3;
  /** Hand rotation on the bar (overhand: fingers down, palm facing the shins). */
  barHand: Record<Side, THREE.Quaternion>;
  /** Relaxed hanging hand (fingers down, palm facing the thigh). */
  restHand: Record<Side, THREE.Quaternion>;
  barOffset: Record<Side, THREE.Vector3>;
  /** The hands open at lockout height so that the plates land exactly at `dropTime`. */
  release: number;
}

const setups = new WeakMap<Rig, LiftSetup>();

function setupFor(rig: Rig): LiftSetup {
  const cached = setups.get(rig);
  if (cached) return cached;
  const m = rigMetrics(rig);
  const k = m.height / 1.85;
  const fm = m.foot.R;
  // Bar over mid-foot, touching the shins once they angle forward in the setup.
  const midFoot = (fm.heelGround.z + fm.tipGround.z) / 2;
  const zBar = midFoot + 0.012 * k;
  const ground = {
    L: new THREE.Vector3(0.15 * k, 0, fm.ballGround.z),
    R: new THREE.Vector3(-0.15 * k, 0, fm.ballGround.z),
  };
  const yaw = { L: 0.2, R: -0.2 };
  const reach = m.upperArm + m.forearm;
  const barHand = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
  const barOffset = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  const restHand = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    handRotation(rig, side, new THREE.Vector3(sx * 0.08, -1, 0.12), new THREE.Vector3(-sx, 0, 0.15), restHand[side]);
    handRotation(rig, side, new THREE.Vector3(0, -1, 0.06), new THREE.Vector3(0, -0.05, -1), barHand[side]);
    gripOffset(rig, side, barHand[side], GRIP_BAR, barOffset[side]);
  }
  // Lockout bar height: shoulder of the standing pose minus straight arms (slightly forward).
  const shoulderY = m.shoulder.L.y - 0.02 * k;
  const yLock = shoulderY - reach * 0.975 + barOffset.L.y;
  const fall = yLock - BARBELL.restHeight;
  const fallTime = (Math.sqrt(RELEASE_SPEED * RELEASE_SPEED + 2 * GRAVITY * fall) - RELEASE_SPEED) / GRAVITY;
  const s: LiftSetup = {
    m, k, zBar, ground, yaw, yLock, reach,
    hipMidBind: m.hipJoint.L.clone().add(m.hipJoint.R).multiplyScalar(0.5),
    barHand, barOffset, restHand,
    release: Math.max(LIFT_EVENTS.lockoutTime + 0.03, LIFT_EVENTS.dropTime - fallTime),
  };
  setups.set(rig, s);
  return s;
}

/**
 * Bar bend at action time t: the bow builds against the floor in the wedge, is at its fullest as
 * the plates break, settles to the working load in the air, springs straight when the hands let
 * go, and whips the other way (centre down) when the plates land.
 */
function barBendAt(s: LiftSetup, t: number) {
  const E = LIFT_EVENTS;
  if (t <= E.liftOffTime) return ramp(T_SLACK0, E.liftOffTime, t);
  if (t < s.release) {
    const settle = ramp(E.liftOffTime, E.liftOffTime + 0.2, t);
    // The plates bob once as they leave the floor; the lifter's max effort in the grind bows it a bit more.
    const bob = 0.1 * Math.sin((t - E.liftOffTime) * Math.PI * 2 * 7) * Math.exp(-(t - E.liftOffTime) / 0.1);
    const grind = 0.08 * bump(E.liftOffTime + 0.3 * (E.lockoutTime - E.liftOffTime), E.liftOffTime + 0.7 * (E.lockoutTime - E.liftOffTime), t);
    return lerp(1, 0.62, settle) - 0.1 * ramp(E.liftOffTime + 0.2, E.lockoutTime, t) + bob + grind;
  }
  if (t < E.dropTime) {
    // Unloaded: the bow springs out with a damped flick.
    const tau = t - s.release;
    return 0.52 * Math.exp(-tau / 0.05) * Math.cos(tau * Math.PI * 2 * 9);
  }
  const tau = t - E.dropTime;
  return -1.05 * Math.exp(-tau / 0.07) * Math.sin(tau * Math.PI * 2 * 8.5);
}

interface BarState {
  /** Bar centre height (with the bow's rise and the grind tremor). */
  y: number;
  z: number;
  bend: number;
  /** Smooth bar height the body is organised around (the hands' bar while gripping, lockout after release). */
  yBody: number;
  /** Height the hip path is keyed by: the plates' height off the floor (the bow's rise left out) in the wedge. */
  yHips: number;
}

const _bar: BarState = { y: 0, z: 0, bend: 0, yBody: 0, yHips: 0 };

/** Bar centre, bend and the heights the body follows at action time t. */
function barState(s: LiftSetup, t: number): BarState {
  const rest = BARBELL.restHeight;
  const E = LIFT_EVENTS;
  const bend = barBendAt(s, t);
  const out = _bar;
  out.bend = bend;
  if (t <= E.liftOffTime) {
    // Wedge: the centre rises with the bow, the plates stay on the platform.
    out.y = rest + groundedRise(bend);
    out.yBody = out.y;
    out.yHips = rest;
  } else if (t < s.release) {
    const base = rest + groundedRise(1);
    const u = Math.min(1, (t - E.liftOffTime) / (E.lockoutTime - E.liftOffTime));
    const smooth = lerp(base, s.yLock, PULL(u)) - 0.004 * bump(E.lockoutTime, E.lockoutTime + 0.2, t);
    // Grind: the bar (and the hands on it) shake as the lifter fights through the knee.
    const w = smoothstep(GRIND[0], GRIND[1], u) * (1 - smoothstep(GRIND[2], GRIND[3], u));
    const tremor = w * (0.0024 * Math.sin(t * Math.PI * 2 * 8.7 + 0.7) + 0.0012 * Math.sin(t * Math.PI * 2 * 13.3 + 2.1));
    out.y = smooth + tremor;
    out.yBody = out.y;
    // The bow's rise fades out of the hip path once the plates are clear of the floor.
    out.yHips = smooth - groundedRise(bend) * (1 - ramp(E.liftOffTime, E.liftOffTime + 0.25, t));
  } else {
    // Dropped: falls from lockout (pushed off a little), then the bumpers bounce.
    const tau = t - s.release;
    const free = s.yLock - RELEASE_SPEED * tau - 0.5 * GRAVITY * tau * tau;
    const y = t < E.dropTime ? free : rest + bounceAt(t - E.dropTime);
    out.y = Math.max(y, rest + groundedRise(bend));
    out.yBody = s.yLock;
    out.yHips = s.yLock;
  }
  const zBody = barZ(s, out.yBody);
  out.z = t < s.release ? barZ(s, out.y) : zBody + RELEASE_PUSH * ramp(s.release, s.release + 0.18, t);
  return out;
}

/** Hip-joint midpoint (y, z) relative to the stance for a bar height (pull path). */
function hipPath(s: LiftSetup, yBar: number, out: THREE.Vector2) {
  const k = s.k;
  const H0 = s.hipMidBind.y;
  const rest = BARBELL.restHeight;
  // Off the floor the hips rise with the shoulders while the knees travel back out of the
  // bar's way (shins vertical as it passes the knee), then the hips drive through.
  const xs = [rest, rest + 0.17 * k, rest + 0.31 * k, rest + 0.44 * k, s.yLock];
  const ys = [0.715 * k, 0.81 * k, 0.885 * k, 0.94 * k, H0 * 0.998];
  const zs = [-0.29 * k, -0.305 * k, -0.285 * k, -0.17 * k, -0.004 * k];
  out.set(spline(xs, ys, yBar), spline(xs, zs, yBar));
  return out;
}

/** Bar path: vertical over mid-foot, easing ~3.5 cm forward around big thighs above the knee. */
function barZ(s: LiftSetup, yBar: number) {
  const knee = s.m.foot.L.ankle.y + s.m.shin;
  return s.zBar + 0.035 * s.k * smootherstep01((yBar - (knee - 0.06 * s.k)) / (0.16 * s.k));
}

const ctx = new PoseContext();
const AX = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _hip2 = new THREE.Vector2();
const _ground = new THREE.Vector3();
const _ankle = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _grip = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _free = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _off = new THREE.Vector3();
const _arm: ArmSwing = { flex: 0, elbow: 0, abduct: 0, across: 0 };

/** Shoulder joint relative to the hip-joint midpoint, in the hips bone frame (current spine pose). */
function shoulderFromHips(rig: Rig, s: LiftSetup, side: Side, out: THREE.Vector3) {
  const b = rig.bones;
  out.copy(b[`upperArm_${side}`].position).applyQuaternion(b[`shoulder_${side}`].quaternion).add(b[`shoulder_${side}`].position);
  out.applyQuaternion(b.chest.quaternion).add(b.chest.position);
  out.applyQuaternion(b.spine.quaternion).add(b.spine.position);
  return out.sub(_v.copy(s.hipMidBind).sub(s.m.hips));
}

/**
 * Pitch τ of the hips bone (about +X) for which the shoulder (hipMid + Rx(τ)·w) is exactly
 * `r` from `target`; picks the root nearest `guess`.
 */
function solvePitch(w: THREE.Vector3, d: THREE.Vector3, r: number, guess: number) {
  const A = w.y * d.y + w.z * d.z;
  const B = w.y * d.z - w.z * d.y;
  const C = (w.lengthSq() + d.lengthSq() - r * r) / 2 - w.x * d.x;
  const M = Math.hypot(A, B);
  if (M < 1e-9) return guess;
  const beta = Math.atan2(B, A);
  const c = THREE.MathUtils.clamp(C / M, -1, 1);
  const half = Math.acos(c);
  const a1 = beta + half;
  const a2 = beta - half;
  const wrap = (a: number) => Math.atan2(Math.sin(a - guess), Math.cos(a - guess));
  return Math.abs(wrap(a1)) < Math.abs(wrap(a2)) ? guess + wrap(a1) : guess + wrap(a2);
}

export function poseLift(rig: Rig, t: number): LiftResult {
  rig.resetPose();
  ctx.begin(rig);
  const b = rig.bones;
  const s = setupFor(rig);
  const m = s.m;
  const k = s.k;
  const E = LIFT_EVENTS;
  const bar = barState(s, t);
  // The body works around the bar in the hands; after the release it holds the lockout.
  const yBody = bar.yBody;
  const zBody = t < s.release ? bar.z : barZ(s, yBody);

  // Feet: approach stance, then step in (right foot first).
  const stepR = smootherstep01((t - T_STEP0) / 0.22);
  const stepL = smootherstep01((t - T_STEP0 - 0.13) / 0.22);
  const footZ = { R: -APPROACH * (1 - stepR), L: -APPROACH * (1 - stepL) };
  const lift = { R: bump(T_STEP0, T_STEP0 + 0.22, t), L: bump(T_STEP0 + 0.13, T_STEP0 + 0.35, t) };
  const narrow = { R: 1 - stepR, L: 1 - stepL };

  // Phase weights.
  const hinge = smootherstep01((t - T_HINGE0) / (T_GRIP - T_HINGE0));
  const gripW = ramp(T_GRIP - 0.16, T_GRIP, t);
  // Hands on the bar until the release, then the arms settle into a hang.
  const armGrip = gripW * (1 - ramp(s.release, s.release + 0.24, t));
  // Exhale after the release: chest and shoulders drop, the chin comes off the lockout.
  const exhale = ramp(s.release - 0.02, s.release + 0.32, t);
  const lockW = ramp(E.lockoutTime - 0.25, E.lockoutTime, t) * (1 - 0.55 * exhale);

  // Spine shape: neutral flat back in the pull, chest up, a touch of extension at lockout.
  quatXYZ(-0.02 - 0.04 * lockW + 0.025 * exhale, 0, 0, b.spine.quaternion);
  quatXYZ(-0.05 * hinge - 0.05 * lockW + 0.04 * exhale, 0, 0, b.chest.quaternion);
  for (const side of ["L", "R"] as const) {
    // Lats on in the pull (depressed, slightly protracted over the bar); retract at lockout.
    setShoulderGirdle(rig, side, 0.06 * hinge * (1 - lockW) - 0.07 * lockW, -0.04 * hinge + 0.02 * lockW * (1 - exhale) - 0.03 * exhale);
  }

  // Hip-joint midpoint.
  const standY = s.hipMidBind.y * 0.985;
  const stanceZ = (footZ.L + footZ.R) / 2;
  _hip2.set(standY, 0.0);
  let pitchGuess = 0.04;
  if (t < T_HINGE0) {
    // Standing (clap, step): a soft bounce on the clap.
    _hip2.set(standY - 0.012 * k * bump(0.12, 0.42, t) - 0.01 * k * bump(T_STEP0, T_STEP0 + 0.35, t), stanceZ + 0.01);
    pitchGuess = 0.06 + 0.08 * bump(0.1, 0.5, t) + 0.12 * ramp(T_STEP0, T_HINGE0, t);
  } else {
    hipPath(s, bar.yHips, _hip2);
    if (t < T_BRACE) {
      // Hinge down from standing to the setup, wedge (hips sink, chest up) in the brace.
      const setupY = _hip2.x + 0.03 * k * (1 - ramp(T_GRIP, T_BRACE, t));
      _hip2.set(lerp(standY, setupY, hinge), lerp(0.01, _hip2.y, hinge));
    }
    pitchGuess = lerp(0.18, 1.1, hinge);
  }
  _mid.set(0, _hip2.x, _hip2.y);

  // Pelvis pitch: solved for the bar grip while holding it (and for the lockout grip after the
  // release, so the torso stays tall), keyed when free.
  let pitch: number;
  const freePitch = pitchGuess;
  if (t >= T_HINGE0) {
    shoulderFromHips(rig, s, "L", _w);
    _grip.set(BARBELL.gripHalfWidth, yBody, zBody);
    _wrist.subVectors(_grip, s.barOffset.L);
    _d.subVectors(_wrist, _mid);
    const solved = solvePitch(_w, _d, s.reach * 0.993, 1.0);
    pitch = lerp(freePitch, solved, gripW);
  } else pitch = freePitch;
  quatXYZ(pitch, 0, 0, _q);
  b.root.position.set(0, 0, 0);
  _v.copy(s.hipMidBind).sub(m.hips).applyQuaternion(_q);
  b.hips.position.subVectors(_mid, _v);
  b.hips.quaternion.copy(_q);

  // Legs: flat feet (toe-out), knees tracking over the toes.
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    const g = s.ground[side];
    _ground.set(g.x * lerp(1, 0.8, narrow[side]), 0, g.z + footZ[side]);
    const yaw = s.yaw[side] * lerp(1, 0.5, narrow[side]);
    flatAnkle(m.foot[side], _ground, yaw, _ankle);
    _ankle.y += 0.07 * k * lift[side];
    _ankle.z -= 0.03 * lift[side];
    _q.setFromAxisAngle(_v.set(0, 1, 0), yaw);
    _q2.setFromAxisAngle(AX, -0.25 * lift[side]);
    _q.multiply(_q2);
    ctx.bonePos(`upperLeg_${side}`, _hip);
    _pole.set(Math.sin(yaw) + sx * 0.25, 0.1, Math.cos(yaw)).multiplyScalar(2 * m.leg).add(_hip);
    ctx.ik(`leg_${side}`, _ankle, _pole, { maxExtension: 0.9995 }, _q);
  }

  // Arms: free swing, chalk clap, bar grip — blended as targets and poles, one IK per arm.
  const handPose: HandPoses = { L: "relaxed", R: "relaxed" };
  const clap = Math.exp(-(((t - E.clapTime) / 0.035) ** 2));
  // The shot opens on the wind-up (hands apart in front of the chest); they part after the rub.
  const clapW = smootherstep01(1 - ramp(0.42, 0.68, t));
  const released = ramp(s.release, s.release + 0.24, t);
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    // Free arm: relaxed hang, reaching towards the bar while hinging; hanging loose by the thighs
    // once the bar has been dropped.
    _arm.flex = lerp(0.08 + 0.25 * ramp(T_STEP0 + 0.1, T_HINGE0, t), 0.05, released);
    _arm.elbow = lerp(0.3 - 0.15 * ramp(T_HINGE0, T_GRIP, t), 0.24, released);
    _arm.abduct = lerp(0.1, 0.16, released);
    _arm.across = 0;
    armSwingTarget(ctx, rig, side, _arm, _free, _pole);
    _hq.copy(s.restHand[side]);
    _wrist.copy(_free);
    if (clapW > 0) {
      clapTargets(rig, s, side, t, _grip, _q2);
      _wrist.lerp(_grip, clapW);
      ctx.bonePos(`upperArm_${side}`, _sh);
      _off.copy(_sh).add(_v.set(sx * 0.3, -0.55, -0.15));
      _pole.lerp(_off, clapW);
      _hq.slerp(_q2, clapW);
      if (clapW > 0.2) handPose[side] = "open";
    }
    if (armGrip > 0) {
      const g = smootherstep01(armGrip);
      _grip.set(sx * BARBELL.gripHalfWidth, yBody, zBody);
      _grip.sub(s.barOffset[side]);
      _wrist.lerp(_grip, g);
      ctx.bonePos(`upperArm_${side}`, _sh);
      _off.copy(_sh).add(_v.set(sx * 0.55, -0.35, -0.6));
      _pole.lerp(_off, g);
      _hq.slerp(s.barHand[side], g);
      handPose[side] = gripW > 0.6 ? "grip" : "open";
    }
    // Fingers spring open as the bar leaves them, then go slack.
    if (t >= s.release) handPose[side] = t < s.release + 0.4 ? "open" : "relaxed";
    ctx.ik(`arm_${side}`, _wrist, _pole, { maxExtension: 0.9999, twistToLower: 0.5 }, _hq);
  }

  // Head: watch the hands through the clap, look down at the bar while stepping in, then a
  // neutral neck with the eyes ~2 m ahead on the floor; chin comes up at lockout and drops to
  // watch the bar land after the release.
  const lookDown = 0.45 * bump(0.0, 0.6, t) * (1 - ramp(0.3, 0.6, t)) + lerp(0.35, 0.55, hinge) * ramp(0.3, 0.7, t);
  const gaze = lerp(lerp(lookDown, 0.08, lockW), 0.45, ramp(s.release + 0.04, s.release + 0.34, t));
  stabiliseHead(ctx, rig, gaze, 0, 0.45);

  updateHelperBones(rig);
  return {
    bar: { y: bar.y, z: bar.z },
    barBend: bar.bend,
    clap,
    events: E,
    hands: handPose,
    gripping: gripW >= 1 && t < s.release,
  };
}

const _c = new THREE.Vector3();
const _cq = new THREE.Quaternion();

/** Wrist target and hand rotation for the chalk clap at time t (model space). */
function clapTargets(rig: Rig, s: LiftSetup, side: Side, t: number, outWrist: THREE.Vector3, outQ: THREE.Quaternion) {
  const k = s.k;
  const sx = side === "L" ? 1 : -1;
  ctx.bonePos("chest", _c);
  ctx.boneQuat("chest", _cq);
  // Separation of the palms: wide wind-up, fast close into the clap, rub, then part.
  const close = spline([0.08, 0.17, 0.25], [0.34 * k, 0.22 * k, 0], t);
  const sep = t < LIFT_EVENTS.clapTime ? close : 0.3 * k * ramp(0.42, 0.55, t);
  const rub = 0.022 * k * Math.sin((t - 0.25) * Math.PI * 2 * 6) * sx * bump(0.25, 0.42, t);
  const palmGap = 0.012 * k;
  _off.set(sx * (sep / 2 + palmGap), 0.19 * k + rub - 0.08 * k * ramp(0.42, 0.68, t), 0.4 * k);
  _off.applyQuaternion(_cq).add(_c);
  // Palms face each other, fingers forward-up.
  _f.set(0, 0.75, 0.66).applyQuaternion(_cq);
  _n.set(-sx, 0, 0).applyQuaternion(_cq);
  handRotation(rig, side, _f, _n, outQ);
  // Palm centre → wrist.
  const L = s.m.handLength;
  const fb = handBindFrame(rig, side);
  outWrist.copy(fb.finger).applyQuaternion(outQ).multiplyScalar(-0.42 * L);
  outWrist.add(_v.copy(fb.palm).applyQuaternion(outQ).multiplyScalar(-0.02 * k)).add(_off);
  return outWrist;
}
