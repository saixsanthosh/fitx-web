/**
 * Camera rig for the intro film (main thread).
 *
 * A shot's camera is a `CameraTrack`: keyframes of position / look-at target / focal length /
 * roll, interpolated with time-parameterised Catmull-Rom (cubic Hermite with time-weighted
 * tangents, so velocity stays continuous across unevenly spaced keys) and an optional easing
 * per segment. Everything is a pure function of the track time, so any frame can be seeked.
 * Handheld shake is deterministic (seeded sines + value noise) and portrait screens get
 * aspect-aware framing.
 *
 * Compositions (BRIEF-2 3.2): a track may author each film composition (`COMPOSITIONS` in
 * films/compositions.ts) on its own. A composition is the frame the pre-rendered cut for that band
 * holds at its render aspect; on any other aspect inside the band the camera shows exactly the
 * cover-fit crop of that frame, which is what the cut shows on that screen, so `?intro=live`
 * previews every cut truthfully. Only near a band boundary are the two neighbouring compositions
 * blended (by log-aspect), so a live resize never jumps.
 */

import * as THREE from "three";
import { COMPOSITIONS, type CompositionBand, type FilmComposition } from "../../films/compositions";
import { clamp, DEG, hash1, lerp, noise1, smoothstep, TAU } from "../math";
import type { Vec3Tuple } from "../types";

/** 36 mm film gauge on the frame's long side (three.js convention for `filmGauge`). */
export const FILM_GAUGE = 36;
/** Default focal length for keys that never set one. */
export const DEFAULT_FOCAL = 35;
/** Exposure time of a 180° shutter at 24 fps; drives the whip-pan blur length. */
export const FILM_SHUTTER = 1 / 48;

export type CameraEase = "linear" | "in" | "out" | "inOut";

export interface CameraKey {
  /** Time on the track's clock (seconds). Keys must be sorted by `t`. */
  t: number;
  position: Vec3Tuple;
  target: Vec3Tuple;
  /** Focal length in mm (36 mm film gauge). Inherits the previous key's value (first key: 35). */
  focal?: number;
  /** Radians about the view axis; positive banks the camera counter-clockwise (the horizon tilts clockwise). Inherits the previous key's value (first key: 0). */
  roll?: number;
  /** Easing of the segment that *starts* at this key. Default `linear`. */
  ease?: CameraEase;
}

export interface CameraShake {
  /** Peak-ish rotational jitter in degrees (0.2–0.5 subtle handheld, ~1.2 running camera). Positional jitter follows at 4 mm per degree. */
  amplitude: number;
  /** Dominant frequency in Hz (handheld ≈ 1.2–2.5). Higher octaves are derived from it. */
  frequency: number;
  seed: number;
}

export interface CameraTrack {
  keys: CameraKey[];
  shake?: CameraShake;
  /**
   * Portrait (aspect < 1) adaptation. Omitted → automatic: the lens widens so the frame's
   * narrow side covers about what the landscape frame's height covers. Present → exactly as
   * given: `keys` replace the landscape keys, `focalScale` multiplies the focal length,
   * `distanceScale` pushes the camera away from (> 1) or toward (< 1) its target. Pass `{}`
   * to opt out of any adaptation.
   */
  portrait?: { keys?: CameraKey[]; focalScale?: number; distanceScale?: number };
  /**
   * Authored compositions (BRIEF-2 3.2). Present → every composition is evaluated at its own render
   * aspect and cover-cropped to the viewport (see the file header). A composition left out falls
   * back to the automatic framing at its render aspect (`portrait` stays the `phone` alias). Absent
   * → the track behaves exactly as before this field existed.
   */
  compositions?: Partial<Record<FilmComposition, CompositionFrame>>;
}

/** One composition's frame of a track (all optional; an empty object means "as keyed"). */
export interface CompositionFrame {
  /** Keys for this composition, on the same clock. Default: the track's keys (`phone`: `portrait.keys` when present). */
  keys?: CameraKey[];
  /** Multiplies the focal length (> 1 tighter). Default 1. */
  focalScale?: number;
  /** Pushes the camera away from (> 1) or toward (< 1) its target. Default 1. */
  distanceScale?: number;
  /**
   * Camera-space move of both the lens and its target, in metres: [right, up, forward] (a truck,
   * pedestal and dolly that keep the perspective). Default none.
   */
  offset?: Vec3Tuple;
}

/** The 16:9 frame the film was first authored for. */
export const BASE_ASPECT = 16 / 9;
/** Above 16:9 the lens widens to keep 16:9's vertical coverage, at most by this factor. */
export const WIDE_FOCAL_CAP = 1.3;
/** Half-width, in log-aspect, of the blend between neighbouring compositions around each band boundary. */
export const COMPOSITION_BLEND = 0.035;

export interface CameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Focal length, mm on 36 mm gauge. */
  focal: number;
  /** Radians about the view axis. */
  roll: number;
}

export function createCameraState(): CameraState {
  return { position: new THREE.Vector3(), target: new THREE.Vector3(0, 0, -1), focal: DEFAULT_FOCAL, roll: 0 };
}

export function copyCameraState(source: CameraState, out: CameraState): CameraState {
  out.position.copy(source.position);
  out.target.copy(source.target);
  out.focal = source.focal;
  out.roll = source.roll;
  return out;
}

function ease(kind: CameraEase | undefined, u: number) {
  // Sine-based eases: gentler than cubic (peak speed π/2 × average), which reads as a
  // weighted dolly/crane rather than a UI animation.
  switch (kind) {
    case "in":
      return 1 - Math.cos((u * Math.PI) / 2);
    case "out":
      return Math.sin((u * Math.PI) / 2);
    case "inOut":
      return 0.5 - 0.5 * Math.cos(u * Math.PI);
    default:
      return u;
  }
}

function focalAt(keys: readonly CameraKey[], index: number) {
  for (let i = index; i >= 0; i -= 1) {
    const focal = keys[i].focal;
    if (focal !== undefined) return focal;
  }
  return DEFAULT_FOCAL;
}

function rollAt(keys: readonly CameraKey[], index: number) {
  for (let i = index; i >= 0; i -= 1) {
    const roll = keys[i].roll;
    if (roll !== undefined) return roll;
  }
  return 0;
}

type Channel = (keys: readonly CameraKey[], index: number, component: number) => number;

const POSITION: Channel = (keys, index, c) => keys[index].position[c];
const TARGET: Channel = (keys, index, c) => keys[index].target[c];
// Zooms read naturally when the focal length changes geometrically, so interpolate log(f).
const LOG_FOCAL: Channel = (keys, index) => Math.log(focalAt(keys, index));
const ROLL: Channel = (keys, index) => rollAt(keys, index);

/**
 * Velocity (units / s) at key `i` for a scalar channel: the time-weighted blend of the two
 * neighbouring chord velocities (non-uniform Catmull-Rom); one-sided at the ends.
 */
function tangent(keys: readonly CameraKey[], value: Channel, i: number, c: number) {
  const n = keys.length;
  if (n < 2) return 0;
  if (i === 0) return (value(keys, 1, c) - value(keys, 0, c)) / Math.max(1e-6, keys[1].t - keys[0].t);
  if (i === n - 1) return (value(keys, n - 1, c) - value(keys, n - 2, c)) / Math.max(1e-6, keys[n - 1].t - keys[n - 2].t);
  const d0 = Math.max(1e-6, keys[i].t - keys[i - 1].t);
  const d1 = Math.max(1e-6, keys[i + 1].t - keys[i].t);
  const v0 = (value(keys, i, c) - value(keys, i - 1, c)) / d0;
  const v1 = (value(keys, i + 1, c) - value(keys, i, c)) / d1;
  return (v0 * d1 + v1 * d0) / (d0 + d1);
}

/** Hermite-interpolates one channel component across segment `i` at eased parameter `s`. */
function segment(keys: readonly CameraKey[], value: Channel, i: number, c: number, s: number, duration: number) {
  return hermite(value(keys, i, c), tangent(keys, value, i, c), value(keys, i + 1, c), tangent(keys, value, i + 1, c), s, duration);
}

function hermite(p0: number, m0: number, p1: number, m1: number, s: number, duration: number) {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * duration * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * duration * m1;
}

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const SHAKE_RATIOS = [1, 1.73, 2.91, 5.17];
const SHAKE_WEIGHTS = [0.5, 0.27, 0.15, 0.08];

/** Smooth, deterministic 1D shake signal in about [-1, 1]. */
function shakeSignal(t: number, frequency: number, seed: number) {
  let sum = 0;
  for (let k = 0; k < 4; k += 1) {
    const phase = hash1(seed * 31 + k * 7) * TAU;
    const jitter = 0.9 + 0.2 * hash1(seed * 17 + k * 13);
    sum += SHAKE_WEIGHTS[k] * Math.sin(TAU * frequency * SHAKE_RATIOS[k] * jitter * t + phase);
  }
  // A value-noise octave breaks the periodicity of the sines.
  return sum + 0.35 * noise1(t * frequency * 1.37, seed);
}

/** Interpolates a key list at `t` (clamped to the key range) into `out`; no framing, no shake. */
function evaluateKeys(keys: readonly CameraKey[], t: number, out: CameraState) {
  const n = keys.length;
  if (n === 0) return out;
  if (n === 1 || t <= keys[0].t) {
    out.position.fromArray(keys[0].position);
    out.target.fromArray(keys[0].target);
    out.focal = focalAt(keys, 0);
    out.roll = rollAt(keys, 0);
  } else if (t >= keys[n - 1].t) {
    out.position.fromArray(keys[n - 1].position);
    out.target.fromArray(keys[n - 1].target);
    out.focal = focalAt(keys, n - 1);
    out.roll = rollAt(keys, n - 1);
  } else {
    let i = 0;
    while (i < n - 2 && t >= keys[i + 1].t) i += 1;
    const a = keys[i];
    const b = keys[i + 1];
    const duration = Math.max(1e-6, b.t - a.t);
    const s = ease(a.ease, clamp((t - a.t) / duration, 0, 1));

    for (let c = 0; c < 3; c += 1) {
      out.position.setComponent(c, segment(keys, POSITION, i, c, s, duration));
      out.target.setComponent(c, segment(keys, TARGET, i, c, s, duration));
    }
    out.focal = Math.exp(segment(keys, LOG_FOCAL, i, 0, s, duration));
    out.roll = segment(keys, ROLL, i, 0, s, duration);
  }
  return out;
}

/** Pushes the lens away from (> 1) or toward (< 1) its target. */
function scaleDistance(out: CameraState, scale: number) {
  if (scale !== 1) out.position.sub(out.target).multiplyScalar(scale).add(out.target);
}

/** The automatic and `portrait` framing as it always was: weight ramps from square (none) to phone portrait (full). */
function legacyPortrait(track: CameraTrack, aspect: number, out: CameraState) {
  if (!(aspect < 1)) return;
  const weight = smoothstep(1, 0.56, aspect);
  let focalScale = 1;
  let distanceScale = 1;
  if (track.portrait) {
    focalScale = track.portrait.focalScale ?? 1;
    distanceScale = track.portrait.distanceScale ?? 1;
  } else {
    // Landscape 16:9 covers h = 36 / 1.78 mm of film on its short side; portrait covers
    // 36 × aspect mm on its short side. Widen the lens by the ratio (capped).
    focalScale = 1 / clamp(1 / (aspect * (16 / 9)), 1, 1.45);
  }
  out.focal *= lerp(1, focalScale, weight);
  scaleDistance(out, lerp(1, distanceScale, weight));
}

/** Above 16:9: the factor the focal length is divided by so the frame keeps 16:9's vertical coverage (capped). */
export function wideFocalFactor(aspect: number) {
  return aspect > BASE_ASPECT ? Math.min(WIDE_FOCAL_CAP, aspect / BASE_ASPECT) : 1;
}

/** Film height and width (mm) a 36 mm gauge covers at this aspect (three.js puts the gauge on the long side). */
const filmHeight = (aspect: number) => FILM_GAUGE / Math.max(aspect, 1);
const filmWidth = (aspect: number) => filmHeight(aspect) * aspect;

/**
 * Focal multiplier that turns a frame rendered at `frameAspect` into its cover-fit crop on a
 * viewport of `viewAspect`: a narrower viewport loses width, a wider one height. 1 when they match.
 */
export function coverZoom(frameAspect: number, viewAspect: number) {
  return Math.max(filmHeight(viewAspect) / filmHeight(frameAspect), filmWidth(viewAspect) / filmWidth(frameAspect));
}

/** The compositions framed as portrait (phone and tablet-p): shots stage tighter for them. */
export function isPortraitComposition(comp: FilmComposition) {
  return comp === "phone" || comp === "tablet-p";
}

const BAND_BY_ID = new Map<FilmComposition, CompositionBand>(COMPOSITIONS.map((band) => [band.id, band]));

/**
 * The compositions a viewport of `aspect` blends, with their weights (they sum to 1): one inside a
 * band, two within `COMPOSITION_BLEND` of a boundary (half and half exactly on it).
 */
export function compositionWeights(aspect: number): { comp: FilmComposition; weight: number }[] {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : BASE_ASPECT;
  const log = Math.log(a);
  for (let index = 0; index < COMPOSITIONS.length - 1; index += 1) {
    const boundary = Math.log(COMPOSITIONS[index].max);
    if (Math.abs(log - boundary) < COMPOSITION_BLEND) {
      const u = (log - (boundary - COMPOSITION_BLEND)) / (2 * COMPOSITION_BLEND);
      const wider = u * u * (3 - 2 * u);
      return [
        { comp: COMPOSITIONS[index].id, weight: 1 - wider },
        { comp: COMPOSITIONS[index + 1].id, weight: wider },
      ];
    }
  }
  const band = COMPOSITIONS.find((entry) => a >= entry.min && a < entry.max) ?? COMPOSITIONS[COMPOSITIONS.length - 1];
  return [{ comp: band.id, weight: 1 }];
}

const _offset = new THREE.Vector3();
const _offsetQuat = new THREE.Quaternion();
const _blendA = createCameraState();
const _blendB = createCameraState();

/**
 * One composition's frame at time `t`, as the cut for its band renders it (at its own render aspect),
 * then cover-cropped to `viewAspect`. No shake.
 */
export function evaluateComposition(track: CameraTrack, comp: FilmComposition, t: number, viewAspect: number, out: CameraState): CameraState {
  const band = BAND_BY_ID.get(comp)!;
  const frameAspect = band.aspect;
  const spec = track.compositions?.[comp];
  const portraitKeys = track.portrait?.keys && track.portrait.keys.length > 0 ? track.portrait.keys : null;
  const keys = spec?.keys && spec.keys.length > 0 ? spec.keys : frameAspect < 1 && portraitKeys ? portraitKeys : track.keys;
  evaluateKeys(keys, t, out);
  if (spec) {
    scaleDistance(out, spec.distanceScale ?? 1);
    if (spec.offset) {
      // Screen axes of this frame (roll and straight-down views included).
      cameraStateQuaternion(out, _offsetQuat);
      _offset.set(spec.offset[0], spec.offset[1], -spec.offset[2]).applyQuaternion(_offsetQuat);
      out.position.add(_offset);
      out.target.add(_offset);
    }
    out.focal *= spec.focalScale ?? 1;
  } else {
    legacyPortrait(track, frameAspect, out);
  }
  out.focal = (out.focal / wideFocalFactor(frameAspect)) * coverZoom(frameAspect, viewAspect);
  return out;
}

/** Shake on top of a framed state (view-axis jitter plus a few millimetres of drift). */
function applyShake(shake: CameraShake | undefined, t: number, out: CameraState) {
  if (!shake || !(shake.amplitude > 0)) return;
  _forward.subVectors(out.target, out.position);
  const distance = _forward.length();
  if (distance <= 1e-6) return;
  _forward.divideScalar(distance);
  _right.crossVectors(_forward, WORLD_UP);
  if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
  _right.normalize();
  _up.crossVectors(_right, _forward);
  const angle = shake.amplitude * DEG;
  const yaw = angle * shakeSignal(t, shake.frequency, shake.seed);
  const pitch = angle * 0.8 * shakeSignal(t, shake.frequency * 0.93, shake.seed + 101);
  const rollJitter = angle * 0.45 * shakeSignal(t, shake.frequency * 0.71, shake.seed + 202);
  const offset = shake.amplitude * 0.004;
  const px = offset * shakeSignal(t, shake.frequency * 0.81, shake.seed + 303);
  const py = offset * shakeSignal(t, shake.frequency * 1.11, shake.seed + 404);
  out.target.addScaledVector(_right, Math.tan(yaw) * distance).addScaledVector(_up, Math.tan(pitch) * distance);
  out.position.addScaledVector(_right, px).addScaledVector(_up, py);
  out.target.addScaledVector(_right, px).addScaledVector(_up, py);
  out.roll += rollJitter;
}

/**
 * Evaluates a track at time `t` (clamped to the key range) for the given viewport aspect
 * (width / height) and writes the result into `out` (also returned). Allocation-free.
 */
export function evaluateCameraTrack(track: CameraTrack, t: number, aspect: number, out: CameraState): CameraState {
  if (track.compositions) {
    const weights = compositionWeights(aspect);
    if (weights.length === 1) {
      evaluateComposition(track, weights[0].comp, t, aspect, out);
    } else {
      evaluateComposition(track, weights[0].comp, t, aspect, _blendA);
      evaluateComposition(track, weights[1].comp, t, aspect, _blendB);
      const w = weights[1].weight;
      out.position.lerpVectors(_blendA.position, _blendB.position, w);
      out.target.lerpVectors(_blendA.target, _blendB.target, w);
      out.focal = Math.exp(lerp(Math.log(_blendA.focal), Math.log(_blendB.focal), w));
      out.roll = lerp(_blendA.roll, _blendB.roll, w);
    }
    applyShake(track.shake, t, out);
    return out;
  }

  const portrait = aspect < 1;
  const keys = portrait && track.portrait?.keys && track.portrait.keys.length > 0 ? track.portrait.keys : track.keys;
  if (keys.length === 0) return out;
  evaluateKeys(keys, t, out);
  // Portrait framing. Weight ramps in from square (no change) to phone portrait (full).
  legacyPortrait(track, aspect, out);
  out.focal /= wideFocalFactor(aspect);
  applyShake(track.shake, t, out);
  return out;
}

const _lookMatrix = new THREE.Matrix4();
const _parentQuat = new THREE.Quaternion();
const _rollQuat = new THREE.Quaternion();
const _lookUp = new THREE.Vector3();
const _dir = new THREE.Vector3();
const VIEW_AXIS = new THREE.Vector3(0, 0, 1);

/** World-space orientation of a camera in `state` (look-at + roll), without touching any camera. */
export function cameraStateQuaternion(state: CameraState, out: THREE.Quaternion): THREE.Quaternion {
  _dir.subVectors(state.target, state.position);
  const length = _dir.length();
  if (length < 1e-9) return out.identity();
  // Straight up/down has no defined horizon: use -Z as screen-up (offset the target a few cm
  // horizontally to choose a different one).
  const vertical = Math.abs(_dir.y) / length > 0.99995;
  _lookUp.set(0, 1, 0);
  if (vertical) _lookUp.set(0, 0, _dir.y < 0 ? -1 : 1);
  _lookMatrix.lookAt(state.position, state.target, _lookUp);
  out.setFromRotationMatrix(_lookMatrix);
  if (state.roll !== 0) out.multiply(_rollQuat.setFromAxisAngle(VIEW_AXIS, state.roll));
  return out;
}

/**
 * Applies a state to a perspective camera: 36 mm film gauge, focal length (updates the
 * projection), position, look-at and roll. Works for cameras parented to a moving group.
 */
export function applyCameraState(camera: THREE.PerspectiveCamera, state: CameraState, aspect: number) {
  camera.filmGauge = FILM_GAUGE;
  camera.aspect = aspect;
  camera.setFocalLength(state.focal);
  camera.position.copy(state.position);
  cameraStateQuaternion(state, camera.quaternion);
  const parent = camera.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    // State is world space; convert to the parent's frame.
    camera.position.copy(parent.worldToLocal(_dir.copy(state.position)));
    parent.matrixWorld.decompose(_up, _parentQuat, _right);
    camera.quaternion.premultiply(_parentQuat.invert());
  }
  camera.updateMatrixWorld(true);
}

const _qNext = new THREE.Quaternion();
const _view = new THREE.Vector3();

export interface WhipBlurOptions {
  /** Exposure time in seconds (default 1/48: 180° shutter at 24 fps). */
  shutter?: number;
  /** Blur shorter than this (frame heights) is dropped so ordinary moves stay crisp. Default 0.004. */
  deadZone?: number;
  /** Max blur length in frame heights. Default 0.3. */
  max?: number;
}

/**
 * Screen-space motion-blur vector for a camera rotating from `prev` to `next` over `dt`
 * seconds, in frame heights (x right, y up): how far image content smears during a film
 * shutter. Feed it straight to `IntroPost.setWhip(vector, 1)`. Translation (parallax) is
 * ignored — this is for whip pans and snap tilts. For seekable renders pass states evaluated
 * at `t - h` and `t` (h ≈ 1/60) rather than the previous rendered frame.
 */
export function whipBlurVector(prev: CameraState, next: CameraState, dt: number, camera: THREE.PerspectiveCamera, options: WhipBlurOptions = {}): [number, number] {
  if (!(dt > 0)) return [0, 0];
  const shutter = options.shutter ?? FILM_SHUTTER;
  const deadZone = options.deadZone ?? 0.004;
  const max = options.max ?? 0.3;

  _view.subVectors(prev.target, prev.position);
  if (_view.lengthSq() < 1e-12) return [0, 0];
  _view.normalize();
  cameraStateQuaternion(next, _qNext);
  _view.applyQuaternion(_qNext.invert());

  const filmHeight = FILM_GAUGE / Math.max(camera.aspect, 1);
  const tanHalf = filmHeight / 2 / Math.max(1, next.focal);
  // Where the previous centre ray lands in the new frame, in frame heights.
  const depth = Math.max(1e-3, -_view.z);
  let x = _view.x / depth / (2 * tanHalf);
  let y = _view.y / depth / (2 * tanHalf);
  if (_view.z >= 0) {
    // More than 90° in one step: direction only.
    const l = Math.hypot(_view.x, _view.y) || 1;
    x = (_view.x / l) * max * 10;
    y = (_view.y / l) * max * 10;
  }
  const scale = shutter / dt;
  x *= scale;
  y *= scale;
  const length = Math.hypot(x, y);
  const effective = Math.min(max, length - deadZone);
  if (!(effective > 0)) return [0, 0];
  const k = effective / length;
  return [x * k, y * k];
}

/**
 * Camera distance at which a subject of `subjectRadius` (m) spans `coverage` of the frame's
 * shorter side (1 = edge to edge) with a `focal` mm lens on 36 mm gauge at this aspect.
 */
export function framingDistance(subjectRadius: number, focal: number, aspect: number, coverage: number) {
  const shortFilm = aspect >= 1 ? FILM_GAUGE / aspect : FILM_GAUGE * aspect;
  const tanHalf = shortFilm / 2 / Math.max(1e-3, focal);
  const alpha = Math.atan(Math.max(1e-4, coverage) * tanHalf);
  return subjectRadius / Math.sin(alpha);
}

/** Vertical field of view (degrees) of a focal length at an aspect, as three.js computes it. */
export function focalToVerticalFov(focal: number, aspect: number) {
  const filmHeight = FILM_GAUGE / Math.max(aspect, 1);
  return (2 * Math.atan(filmHeight / 2 / focal)) / DEG;
}
