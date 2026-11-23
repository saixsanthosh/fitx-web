/**
 * Cleans the landmark stream before anything is measured from it, for the two tracking faults that
 * most often fake or spoil a rep:
 *
 * - Glitches: a landmark that leaps further than a body can move in one frame (usually while it is
 *   half hidden) is marked as not seen for that frame instead of being believed. If it stays in its
 *   new place for a few frames, the move was real and it is accepted.
 * - Left/right swaps: side-on, the model sometimes trades the near and far limb for a frame or two.
 *   A pair of limbs that has exactly traded places is swapped back, and accepted only if it persists
 *   (someone really turning round).
 *
 * It also gives a smoothed copy of the landmarks for drawing and framing, so the overlay and the
 * automatic zoom don't shiver. Counting uses the cleaned, unsmoothed landmarks; the rule engine
 * smooths its own measurements.
 */
import { OneEuroFilter } from "./smoothing";
import type { PosePoint } from "./landmarks";
import { LANDMARK, LANDMARK_COUNT } from "./landmarks";

export interface StabiliserOptions {
  /** Fastest believable landmark speed, in torso lengths per second. */
  maxSpeed?: number;
  /** A jump within one frame of at most this many torso lengths is always believed (fast frames). */
  freeJump?: number;
  /** Frames a changed position (or swap) must persist before it is accepted. */
  confirmFrames?: number;
  /** Landmarks below this visibility are not tracked. */
  minVisibility?: number;
}

export interface Stabilised {
  /** Landmarks for measuring: glitches marked unseen (visibility 0), swaps undone. */
  points: PosePoint[];
  /** Smoothed landmarks for drawing and framing. */
  smooth: PosePoint[];
  /** Landmarks marked unseen in this frame as glitches. */
  rejected: number;
  /** Limb pairs swapped back in this frame. */
  unswapped: number;
}

/** Left/right landmark pairs of the limbs (shoulders to feet). */
const PAIRS: ReadonlyArray<readonly [number, number]> = [
  [LANDMARK.leftShoulder, LANDMARK.rightShoulder],
  [LANDMARK.leftElbow, LANDMARK.rightElbow],
  [LANDMARK.leftWrist, LANDMARK.rightWrist],
  [LANDMARK.leftHip, LANDMARK.rightHip],
  [LANDMARK.leftKnee, LANDMARK.rightKnee],
  [LANDMARK.leftAnkle, LANDMARK.rightAnkle],
  [LANDMARK.leftHeel, LANDMARK.rightHeel],
  [LANDMARK.leftFootIndex, LANDMARK.rightFootIndex],
];
/** Limbs checked for a swap, each on its own: [left landmarks it is judged by, left landmarks it swaps]. */
const SWAP_LIMBS: ReadonlyArray<{ judge: readonly number[]; moves: readonly number[] }> = [
  { judge: [LANDMARK.leftElbow, LANDMARK.leftWrist], moves: [LANDMARK.leftElbow, LANDMARK.leftWrist, LANDMARK.leftPinky, LANDMARK.leftIndex, LANDMARK.leftThumb] },
  { judge: [LANDMARK.leftKnee, LANDMARK.leftAnkle], moves: [LANDMARK.leftKnee, LANDMARK.leftAnkle, LANDMARK.leftHeel, LANDMARK.leftFootIndex] },
];
const PARTNER = new Map<number, number>([
  ...PAIRS,
  [LANDMARK.leftPinky, LANDMARK.rightPinky],
  [LANDMARK.leftIndex, LANDMARK.rightIndex],
  [LANDMARK.leftThumb, LANDMARK.rightThumb],
].flatMap(([a, b]) => [[a, b], [b, a]] as Array<[number, number]>));

interface Track {
  x: number;
  y: number;
  t: number;
  /** A competing position seen in the last frames, and for how many frames in a row. */
  pending: { x: number; y: number; frames: number } | null;
}

/** Stops a stale track from judging a landmark seen again after this long. */
const TRACK_STALE_MS = 400;

export class LandmarkStabiliser {
  private readonly maxSpeed: number;
  private readonly freeJump: number;
  private readonly confirmFrames: number;
  private readonly minVisibility: number;
  private tracks: Array<Track | null> = [];
  private filters: Array<{ x: OneEuroFilter; y: OneEuroFilter; z: OneEuroFilter }> = [];
  private torso: number | null = null;
  /** Frames in a row each limb has looked swapped. */
  private swapFrames: number[] = SWAP_LIMBS.map(() => 0);

  constructor(options: StabiliserOptions = {}) {
    this.maxSpeed = options.maxSpeed ?? 9;
    this.freeJump = options.freeJump ?? 0.3;
    this.confirmFrames = options.confirmFrames ?? 3;
    this.minVisibility = options.minVisibility ?? 0.5;
    this.reset();
  }

  reset(): void {
    this.tracks = Array.from({ length: LANDMARK_COUNT }, () => null);
    // Normalised image units: little smoothing while still, almost none at full speed.
    this.filters = Array.from({ length: LANDMARK_COUNT }, () => ({ x: new OneEuroFilter(1.4, 6), y: new OneEuroFilter(1.4, 6), z: new OneEuroFilter(1.4, 6) }));
    this.torso = null;
    this.swapFrames = SWAP_LIMBS.map(() => 0);
  }

  /** `points` are image-normalised; `aspect` is width / height; `t` in milliseconds. */
  stabilise(input: readonly PosePoint[], aspect: number, t: number): Stabilised {
    const points = input.map((point) => ({ ...point }));
    const torso = torsoLength(points, aspect, this.minVisibility);
    if (torso !== null) this.torso = this.torso === null ? torso : this.torso * 0.9 + torso * 0.1;
    let unswapped = 0;
    SWAP_LIMBS.forEach((limb, index) => {
      if (!this.isSwapped(limb.judge, points, aspect)) {
        this.swapFrames[index] = 0;
        return;
      }
      this.swapFrames[index] += 1;
      if (this.swapFrames[index] < this.confirmFrames) {
        swapLimb(points, limb.moves);
        unswapped += 1;
      } else {
        // The swap has lasted: the person really turned. Follow the new sides from here.
        this.swapFrames[index] = 0;
        for (const left of limb.moves) {
          const right = PARTNER.get(left) as number;
          [this.tracks[left], this.tracks[right]] = [this.tracks[right], this.tracks[left]];
        }
      }
    });

    let rejected = 0;
    const scale = this.torso;
    for (let index = 0; index < points.length && index < LANDMARK_COUNT; index += 1) {
      const point = points[index];
      if (!seen(point, this.minVisibility)) continue;
      const track = this.tracks[index];
      if (!track || scale === null || t - track.t > TRACK_STALE_MS || t <= track.t) {
        this.tracks[index] = { x: point.x, y: point.y, t, pending: null };
        continue;
      }
      const moved = Math.hypot((point.x - track.x) * aspect, point.y - track.y) / scale;
      const allowed = Math.max(this.freeJump, (this.maxSpeed * (t - track.t)) / 1000);
      if (moved <= allowed) {
        this.tracks[index] = { x: point.x, y: point.y, t, pending: null };
        continue;
      }
      const pending = track.pending;
      const samePlace = pending && Math.hypot((point.x - pending.x) * aspect, point.y - pending.y) / scale <= allowed;
      const frames = samePlace && pending ? pending.frames + 1 : 1;
      if (frames >= this.confirmFrames) {
        this.tracks[index] = { x: point.x, y: point.y, t, pending: null };
        continue;
      }
      track.pending = { x: point.x, y: point.y, frames };
      points[index] = { ...point, visibility: 0 };
      rejected += 1;
    }

    const smooth = points.map((point, index) => {
      const filter = this.filters[index];
      if (!filter || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point;
      return { ...point, x: filter.x.filter(point.x, t), y: filter.y.filter(point.y, t), z: point.z === undefined ? undefined : filter.z.filter(point.z, t) };
    });
    return { points, smooth, rejected, unswapped };
  }

  /** Whether this limb has traded places with its partner since the last frame (and clearly so). */
  private isSwapped(judge: readonly number[], points: readonly PosePoint[], aspect: number): boolean {
    if (this.torso === null) return false;
    let stay = 0;
    let cross = 0;
    for (const left of judge) {
      const right = PARTNER.get(left) as number;
      const a = points[left];
      const b = points[right];
      const ta = this.tracks[left];
      const tb = this.tracks[right];
      if (!seen(a, this.minVisibility) || !seen(b, this.minVisibility) || !ta || !tb) return false;
      const d = (p: PosePoint, q: { x: number; y: number }) => Math.hypot((p.x - q.x) * aspect, p.y - q.y);
      stay += d(a, ta) + d(b, tb);
      cross += d(a, tb) + d(b, ta);
    }
    // Only a clear trade counts: the limbs jumped a long way and land almost exactly on each other's places.
    return stay > this.torso * 0.6 && cross < stay * 0.3;
  }
}

function seen(point: PosePoint | undefined, minVisibility: number): point is PosePoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= minVisibility;
}

function swapLimb(points: PosePoint[], moves: readonly number[]) {
  for (const left of moves) {
    const right = PARTNER.get(left) as number;
    [points[left], points[right]] = [points[right], points[left]];
  }
}

/** Shoulder centre to hip centre, in image heights, from clearly seen landmarks. */
export function torsoLength(points: readonly PosePoint[], aspect: number, minVisibility = 0.5): number | null {
  const ls = points[LANDMARK.leftShoulder];
  const rs = points[LANDMARK.rightShoulder];
  const lh = points[LANDMARK.leftHip];
  const rh = points[LANDMARK.rightHip];
  const shoulders = [ls, rs].filter((p) => seen(p, minVisibility));
  const hips = [lh, rh].filter((p) => seen(p, minVisibility));
  if (!shoulders.length || !hips.length) return null;
  const mid = (list: PosePoint[]) => ({ x: (list.reduce((s, p) => s + p.x, 0) / list.length) * aspect, y: list.reduce((s, p) => s + p.y, 0) / list.length });
  const a = mid(shoulders);
  const b = mid(hips);
  const length = Math.hypot(a.x - b.x, a.y - b.y);
  return length > 0.02 ? length : null;
}
