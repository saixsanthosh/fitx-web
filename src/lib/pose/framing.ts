/**
 * Automatic framing for AI Form Check: a digital crop and zoom that follows the body, so the member is
 * shown large and whole without placing the phone perfectly, plus a plain judgement of whether the
 * camera's view is good enough and what to change when it isn't.
 *
 * The crop covers everywhere the body has been over the last few seconds (the whole range of a squat
 * or an overhead press), with room above the head, and moves slowly with a dead zone so it never
 * pumps with each rep. It only changes what is shown: the pose model always analyses the full camera
 * picture, so nothing outside the crop is ever missed. Zoom is capped by the camera's own resolution,
 * so a small picture is never blown up into mush.
 *
 * Coordinates: crops are fractions of the camera picture (0..1 on each axis).
 */
import type { PosePoint } from "./landmarks";
import { LANDMARK } from "./landmarks";

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_FRAME: Crop = { x: 0, y: 0, w: 1, h: 1 };

export type FramingIssue = "none" | "no-body" | "cut-top" | "cut-bottom" | "cut-left" | "cut-right" | "too-far" | "too-close";

export interface FramingAssessment {
  issue: FramingIssue;
  /** What to do about it, or null when the view is fine. */
  hint: string | null;
  /** "good": nothing to change; "fair": usable, could be better; "poor": the analysis can't be relied on. */
  quality: "good" | "fair" | "poor";
  /** The body's height as a share of the picture's height (0 when unknown). */
  fill: number;
  /** On-screen direction to move in, for an arrow; null when no move helps. */
  move: "left" | "right" | "back" | "closer" | null;
}

export interface FramingSpec {
  /** Room above the body's highest point, as a share of the body's height (more for overhead moves). */
  headroom: number;
  /** The rule needs the feet (squats, lunges): cut-off feet make the view poor rather than fair. */
  needsFeet: boolean;
  /** The member faces the camera, so "your left" and "your right" make sense; side-on they don't. */
  facingCamera: boolean;
}

export interface FramingOptions {
  /** How long the body's past positions stay in the crop, ms. */
  envelopeMs?: number;
  /** Seconds it takes the crop to cover about two thirds of a change (0 = jump straight there). */
  easeMs?: number;
  /** Largest zoom (crop height 1 / maxZoom), from the camera's resolution. */
  maxZoom?: number;
}

/** Landmark visibility needed for a point to place the body. */
const PLACE_VISIBILITY = 0.5;
/** The picture's edge zone: a body part this close to an edge (or beyond it) is cut off. */
const EDGE = 0.015;
/** Body smaller than this share of the picture height is too far for reliable landmarks. */
const TOO_FAR_FILL = 0.28;
/** Crop changes smaller than this share are ignored, so the picture holds still. */
const DEAD_ZONE = 0.06;

const HEAD = [LANDMARK.nose, LANDMARK.leftEye, LANDMARK.rightEye, LANDMARK.leftEar, LANDMARK.rightEar];
const FEET = [LANDMARK.leftAnkle, LANDMARK.rightAnkle, LANDMARK.leftHeel, LANDMARK.rightHeel, LANDMARK.leftFootIndex, LANDMARK.rightFootIndex];
const BODY = [
  ...HEAD,
  LANDMARK.leftShoulder, LANDMARK.rightShoulder, LANDMARK.leftElbow, LANDMARK.rightElbow, LANDMARK.leftWrist, LANDMARK.rightWrist,
  LANDMARK.leftHip, LANDMARK.rightHip, LANDMARK.leftKnee, LANDMARK.rightKnee, ...FEET,
];

export interface BodyBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Head and feet were found (so the box reaches the top of the head and the soles). */
  head: boolean;
  feet: boolean;
}

/**
 * The box around the body in picture fractions, from landmarks seen clearly. The top of the head sits
 * above the eyes by about the nose-to-shoulder distance; the soles sit a little below the heels.
 * Landmarks the model places outside the picture (with low presence) still widen the box, which is
 * how a cut-off body is recognised.
 */
export function bodyBox(points: readonly PosePoint[] | null): BodyBox | null {
  if (!points || points.length < 33) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const index of BODY) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || (point.visibility ?? 1) < PLACE_VISIBILITY) continue;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    count += 1;
  }
  if (count < 4) return null;
  const head = HEAD.some((index) => (points[index]?.visibility ?? 0) >= PLACE_VISIBILITY);
  const feet = FEET.some((index) => (points[index]?.visibility ?? 0) >= PLACE_VISIBILITY);
  const nose = points[LANDMARK.nose];
  const shoulders = [points[LANDMARK.leftShoulder], points[LANDMARK.rightShoulder]].filter((p) => (p?.visibility ?? 0) >= PLACE_VISIBILITY);
  if (head && nose && shoulders.length) {
    const shoulderY = shoulders.reduce((sum, p) => sum + p.y, 0) / shoulders.length;
    const neck = Math.abs(shoulderY - nose.y);
    // Upright, the crown is above the nose; lying down, it is beside it. Either way it is within this reach.
    minY = Math.min(minY, nose.y - neck * 0.75);
  }
  if (feet) maxY += (maxY - minY) * 0.02;
  return { minX, minY, maxX, maxY, head, feet };
}

/**
 * The crop of `viewAspect` (display width / height) that shows `box` with room around it, as a share
 * of a picture of `aspect` (width / height). It never zooms past `maxZoom`; it may reach past the
 * picture's edges when the body fills it (the display then shows the whole picture).
 */
export function cropFor(box: Pick<BodyBox, "minX" | "minY" | "maxX" | "maxY">, aspect: number, viewAspect: number, headroom: number, maxZoom: number): Crop {
  const bodyH = Math.max(0.05, box.maxY - box.minY);
  const top = box.minY - bodyH * headroom;
  const bottom = box.maxY + bodyH * 0.07;
  const sidePad = bodyH * 0.14 / aspect;
  let x = box.minX - sidePad;
  let w = box.maxX - box.minX + 2 * sidePad;
  let y = top;
  let h = bottom - top;
  // Match the view's shape: widen or heighten the box around its centre (in picture pixels).
  const pxRatio = (w * aspect) / h;
  if (pxRatio < viewAspect) {
    const wanted = (h * viewAspect) / aspect;
    x -= (wanted - w) / 2;
    w = wanted;
  } else {
    const wanted = (w * aspect) / viewAspect;
    y -= (wanted - h) / 2;
    h = wanted;
  }
  // Never closer than maxZoom allows, and never smaller than the picture shown whole (zoom 1).
  const fullH = Math.min(1, aspect / viewAspect);
  const minH = fullH / Math.max(1, maxZoom);
  if (h < minH) {
    const cy = y + h / 2;
    const cx = x + w / 2;
    h = minH;
    w = (h * viewAspect) / aspect;
    x = cx - w / 2;
    y = cy - h / 2;
  }
  if (h > fullH && w > Math.min(1, viewAspect / aspect)) return centredFull(aspect, viewAspect);
  // Slide the crop back inside the picture where it can be.
  if (w <= 1) x = Math.min(Math.max(x, 0), 1 - w);
  else x = (1 - w) / 2;
  if (h <= 1) y = Math.min(Math.max(y, 0), 1 - h);
  else y = (1 - h) / 2;
  return { x, y, w, h };
}

/** The whole picture, shown at the view's shape (letterboxed where the shapes differ). */
function centredFull(aspect: number, viewAspect: number): Crop {
  if (viewAspect >= aspect) {
    const w = viewAspect / aspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = aspect / viewAspect;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/** Zoom of a crop relative to the whole picture shown at the same view shape. */
export function zoomOf(crop: Crop, aspect: number, viewAspect: number): number {
  return centredFull(aspect, viewAspect).h / crop.h;
}

/**
 * The largest zoom worth showing: up to two screen pixels per camera pixel (so a 1080p picture on a
 * phone can zoom in, a 480p one barely), and never more than 3×. `shownHeight` is the display's height
 * in device pixels when the whole picture is shown.
 */
export function maxZoomFor(pictureHeight: number, shownHeight: number): number {
  if (!(pictureHeight > 0) || !(shownHeight > 0)) return 1;
  return Math.min(3, Math.max(1.5, (2 * pictureHeight) / shownHeight));
}

/** Judges the view from the body box: is anything cut off, is the member too far, and what helps. */
export function assessFraming(box: BodyBox | null, spec: FramingSpec, mirrored: boolean): FramingAssessment {
  if (!box) return { issue: "no-body", hint: "Step into view of the camera.", quality: "poor", fill: 0, move: null };
  const fill = Math.max(0, Math.min(1, box.maxY) - Math.max(0, box.minY));
  const cutTop = box.minY < EDGE || !box.head;
  const cutBottom = box.maxY > 1 - EDGE || !box.feet;
  const cutLeft = box.minX < EDGE;
  const cutRight = box.maxX > 1 - EDGE;
  // On screen, a mirrored picture swaps left and right.
  const screenLeft = mirrored ? cutRight : cutLeft;
  const screenRight = mirrored ? cutLeft : cutRight;
  if (cutTop && cutBottom && spec.needsFeet) {
    return { issue: "too-close", hint: "You're too close. Step back until your head and feet are both in view.", quality: "poor", fill, move: "back" };
  }
  if (screenLeft !== screenRight) {
    // Facing the camera, moving to your right moves you to the left of a mirrored screen and of a
    // rear camera's picture alike; side-on, only the arrow says which way.
    const towardsScreenRight = screenLeft;
    const hint = spec.facingCamera
      ? `Step a little to your ${towardsScreenRight === mirrored ? "right" : "left"} so your whole body is in view.`
      : "Move along a little, towards the middle of the picture.";
    return { issue: cutLeft ? "cut-left" : "cut-right", hint, quality: "poor", fill, move: towardsScreenRight ? "right" : "left" };
  }
  if (cutBottom && spec.needsFeet) {
    return { issue: "cut-bottom", hint: "Your feet are out of view. Step back, or stand the phone a little lower.", quality: "poor", fill, move: "back" };
  }
  if (cutTop) {
    return { issue: "cut-top", hint: "Your head is out of view. Step back, or tilt the phone up a little.", quality: spec.needsFeet ? "fair" : "poor", fill, move: "back" };
  }
  if (fill < TOO_FAR_FILL) {
    return { issue: "too-far", hint: "You're quite far away. Come a step or two closer for steadier tracking.", quality: fill < TOO_FAR_FILL * 0.6 ? "poor" : "fair", fill, move: "closer" };
  }
  if (cutBottom) return { issue: "none", hint: null, quality: "fair", fill, move: null };
  return { issue: "none", hint: null, quality: "good", fill, move: null };
}

/**
 * Follows the body with a slow, steady crop. Call `update` with each analysed frame; it returns the
 * crop to show now and the judgement of the view.
 */
export class AutoFramer {
  private readonly envelopeMs: number;
  private easeMs: number;
  private maxZoom: number;
  private boxes: Array<{ t: number; box: BodyBox }> = [];
  private current: Crop | null = null;
  private target: Crop | null = null;
  private lastT: number | null = null;
  private lostSince: number | null = null;

  constructor(options: FramingOptions = {}) {
    this.envelopeMs = options.envelopeMs ?? 3000;
    this.easeMs = options.easeMs ?? 520;
    this.maxZoom = options.maxZoom ?? 2;
  }

  setMaxZoom(maxZoom: number): void {
    this.maxZoom = maxZoom;
  }

  setEase(easeMs: number): void {
    this.easeMs = easeMs;
  }

  reset(): void {
    this.boxes = [];
    this.current = null;
    this.target = null;
    this.lastT = null;
    this.lostSince = null;
  }

  update(points: readonly PosePoint[] | null, t: number, aspect: number, viewAspect: number, spec: FramingSpec, mirrored: boolean): { crop: Crop; assessment: FramingAssessment } {
    const box = bodyBox(points);
    const assessment = assessFraming(box, spec, mirrored);
    const full = centredFull(aspect, viewAspect);
    while (this.boxes.length && t - this.boxes[0].t > this.envelopeMs) this.boxes.shift();
    if (box) {
      this.boxes.push({ t, box });
      this.lostSince = null;
    } else {
      this.lostSince ??= t;
    }
    let goal: Crop;
    if (this.boxes.length === 0 || (this.lostSince !== null && t - this.lostSince > 1200) || assessment.issue === "too-close") {
      // Nobody for a while, or the body fills the picture: show all of it so they can find themselves.
      goal = full;
    } else {
      const union = this.boxes.reduce(
        (all, { box: b }) => ({ minX: Math.min(all.minX, b.minX), minY: Math.min(all.minY, b.minY), maxX: Math.max(all.maxX, b.maxX), maxY: Math.max(all.maxY, b.maxY) }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      );
      goal = cropFor(union, aspect, viewAspect, spec.headroom, this.maxZoom);
    }
    // Hold still unless the goal has moved meaningfully, or the body is leaving the shown area.
    if (!this.target || differs(goal, this.target) || (box && !inside(box, this.target))) this.target = goal;
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(250, t - this.lastT));
    this.lastT = t;
    if (!this.current || this.easeMs <= 0) {
      this.current = { ...this.target };
    } else {
      const k = 1 - Math.exp(-dt / this.easeMs);
      this.current = {
        x: this.current.x + (this.target.x - this.current.x) * k,
        y: this.current.y + (this.target.y - this.current.y) * k,
        w: this.current.w + (this.target.w - this.current.w) * k,
        h: this.current.h + (this.target.h - this.current.h) * k,
      };
    }
    return { crop: { ...this.current }, assessment };
  }
}

function differs(a: Crop, b: Crop): boolean {
  const size = Math.max(a.h, b.h);
  return Math.abs(a.h - b.h) / size > DEAD_ZONE || Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) / Math.max(a.w, b.w) > DEAD_ZONE || Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) / size > DEAD_ZONE;
}

function inside(box: BodyBox, crop: Crop): boolean {
  return box.minX >= crop.x && box.maxX <= crop.x + crop.w && box.minY >= crop.y && box.maxY <= crop.y + crop.h;
}

/**
 * The CSS transform that shows `crop` filling a view of `viewWidth` × `viewHeight`, for a layer that
 * draws the whole picture at `baseWidth` × `baseHeight` from the view's top-left corner.
 */
export function cropTransform(crop: Crop, baseWidth: number, baseHeight: number, viewWidth: number, viewHeight: number): string {
  const scale = Math.min(viewWidth / (crop.w * baseWidth), viewHeight / (crop.h * baseHeight));
  const tx = (viewWidth - crop.w * baseWidth * scale) / 2 - crop.x * baseWidth * scale;
  const ty = (viewHeight - crop.h * baseHeight * scale) / 2 - crop.y * baseHeight * scale;
  return `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
}
