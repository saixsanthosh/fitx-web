import { test } from "node:test";
import assert from "node:assert/strict";
import type { PosePoint } from "@/lib/pose/landmarks";
import { LANDMARK } from "@/lib/pose/landmarks";
import type { FramingSpec } from "@/lib/pose/framing";
import { assessFraming, AutoFramer, bodyBox, cropFor, cropTransform, maxZoomFor, zoomOf } from "@/lib/pose/framing";

const STANDING: FramingSpec = { headroom: 0.12, needsFeet: true, facingCamera: false };
const FRONT: FramingSpec = { headroom: 0.12, needsFeet: true, facingCamera: true };

/**
 * A person standing in the picture: `cx` across, from `top` (eyes) to `bottom` (heels), in picture
 * fractions; `squat` (0..1) lowers the head and hips. Landmarks outside the picture keep their place
 * (MediaPipe extrapolates them) but with low visibility, as the model gives them.
 */
function person(cx: number, top: number, bottom: number, squat = 0): PosePoint[] {
  const h = bottom - top;
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({ x: cx, y: (top + bottom) / 2, visibility: 0.05 }));
  const put = (index: number, x: number, y: number) => {
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    points[index] = { x, y, visibility: inside ? 0.95 : 0.2 };
  };
  const drop = squat * h * 0.3;
  for (const index of [LANDMARK.nose, LANDMARK.leftEye, LANDMARK.rightEye, LANDMARK.leftEar, LANDMARK.rightEar]) put(index, cx, top + drop);
  put(LANDMARK.leftShoulder, cx - 0.03, top + 0.12 * h + drop);
  put(LANDMARK.rightShoulder, cx + 0.03, top + 0.12 * h + drop);
  put(LANDMARK.leftElbow, cx - 0.04, top + 0.3 * h + drop);
  put(LANDMARK.rightElbow, cx + 0.04, top + 0.3 * h + drop);
  put(LANDMARK.leftWrist, cx - 0.04, top + 0.45 * h + drop);
  put(LANDMARK.rightWrist, cx + 0.04, top + 0.45 * h + drop);
  put(LANDMARK.leftHip, cx - 0.02, top + 0.5 * h + drop);
  put(LANDMARK.rightHip, cx + 0.02, top + 0.5 * h + drop);
  put(LANDMARK.leftKnee, cx - 0.02 + squat * 0.05, top + 0.75 * h);
  put(LANDMARK.rightKnee, cx + 0.02 + squat * 0.05, top + 0.75 * h);
  for (const index of [LANDMARK.leftAnkle, LANDMARK.rightAnkle, LANDMARK.leftHeel, LANDMARK.rightHeel, LANDMARK.leftFootIndex, LANDMARK.rightFootIndex]) put(index, cx, bottom);
  return points;
}

test("the body box reaches above the eyes to the top of the head, and knows when head or feet are missing", () => {
  const box = bodyBox(person(0.5, 0.3, 0.8));
  assert.ok(box);
  assert.ok(box.minY < 0.3 - 0.03, `the crown sits above the eyes (${box.minY.toFixed(3)})`);
  assert.equal(box.head, true);
  assert.equal(box.feet, true);
  const cut = bodyBox(person(0.5, 0.3, 1.2));
  assert.equal(cut?.feet, false, "feet below the picture are not seen");
  assert.equal(bodyBox(null), null);
});

test("a small person far away is zoomed in on, with room above the head, as far as the camera allows", () => {
  const box = { minX: 0.45, maxX: 0.55, minY: 0.4, maxY: 0.7 };
  const crop = cropFor(box, 16 / 9, 16 / 9, 0.12, 3);
  assert.ok(crop.y <= box.minY - 0.3 * 0.12 + 1e-9, "headroom above the head");
  assert.ok(crop.y + crop.h >= box.maxY, "feet inside");
  assert.ok(crop.x <= box.minX && crop.x + crop.w >= box.maxX, "sides inside");
  assert.ok(Math.abs((crop.w * 16) / 9 / crop.h - 16 / 9) < 1e-9, "the crop has the view's shape");
  assert.ok(zoomOf(crop, 16 / 9, 16 / 9) > 2, `zoomed ${zoomOf(crop, 16 / 9, 16 / 9).toFixed(2)}x`);
  const capped = cropFor(box, 16 / 9, 16 / 9, 0.12, 1.5);
  assert.ok(Math.abs(zoomOf(capped, 16 / 9, 16 / 9) - 1.5) < 1e-9, "never past the zoom the camera's resolution allows");
});

test("a portrait view of a landscape camera crops the sides to fill the phone screen", () => {
  const crop = cropFor({ minX: 0.42, maxX: 0.58, minY: 0.1, maxY: 0.9 }, 16 / 9, 9 / 16, 0.05, 2);
  assert.ok(crop.w < 1, "only part of the width is shown");
  assert.ok(Math.abs((crop.w * 16) / 9 / crop.h - 9 / 16) < 1e-9);
  assert.ok(crop.x <= 0.42 && crop.x + crop.w >= 0.58);
});

test("a body filling the picture shows the whole picture", () => {
  const crop = cropFor({ minX: 0.05, maxX: 0.95, minY: 0.02, maxY: 0.98 }, 4 / 3, 4 / 3, 0.12, 3);
  assert.deepEqual(crop, { x: 0, y: 0, w: 1, h: 1 });
});

test("the view is judged plainly: what is cut off, and which way to move", () => {
  assert.equal(assessFraming(bodyBox(person(0.5, 0.2, 0.9)), STANDING, true).quality, "good");
  const feet = assessFraming(bodyBox(person(0.5, 0.2, 1.15)), STANDING, true);
  assert.equal(feet.issue, "cut-bottom");
  assert.match(feet.hint ?? "", /feet are out of view/);
  assert.equal(feet.quality, "poor");
  const close = assessFraming(bodyBox(person(0.5, -0.1, 1.15)), STANDING, true);
  assert.equal(close.issue, "too-close");
  assert.equal(close.move, "back");
  const far = assessFraming(bodyBox(person(0.5, 0.5, 0.65)), STANDING, true);
  assert.equal(far.issue, "too-far");
  assert.equal(far.move, "closer");
  assert.equal(assessFraming(null, STANDING, true).issue, "no-body");
});

test("small rooms: cut-off feet are fine for exercises that don't need them", () => {
  const curl: FramingSpec = { headroom: 0.12, needsFeet: false, facingCamera: false };
  const view = assessFraming(bodyBox(person(0.5, 0.15, 1.2)), curl, true);
  assert.equal(view.issue, "none");
  assert.equal(view.quality, "fair");
});

test("left and right are said the way the member sees them, mirrored or not", () => {
  // Cut off at the picture's right edge.
  const edge = bodyBox(person(0.99, 0.2, 0.9));
  // Selfie camera, shown mirrored: the member sees themselves cut off at the screen's left; stepping to their right fixes it.
  const selfie = assessFraming(edge, FRONT, true);
  assert.equal(selfie.issue, "cut-right");
  assert.equal(selfie.move, "right");
  assert.match(selfie.hint ?? "", /to your right/);
  // Rear camera, not mirrored, member facing it: the picture's right edge is their left side.
  const rear = assessFraming(edge, FRONT, false);
  assert.equal(rear.move, "left");
  assert.match(rear.hint ?? "", /to your right/, "their right moves them to the picture's left");
  // Side-on there is no "your right": the arrow says which way.
  const side = assessFraming(edge, STANDING, true);
  assert.match(side.hint ?? "", /towards the middle/);
});

test("the crop covers a squat's whole range and holds still from rep to rep", () => {
  const framer = new AutoFramer({ easeMs: 0 });
  const crops = [];
  for (let t = 0; t <= 8000; t += 33) {
    const squat = (1 - Math.cos((2 * Math.PI * t) / 2000)) / 2;
    crops.push(framer.update(person(0.5, 0.35, 0.75, squat), t, 16 / 9, 16 / 9, STANDING, true).crop);
  }
  const settled = crops.slice(Math.floor(crops.length / 2));
  const heights = settled.map((crop) => crop.h);
  assert.ok(Math.max(...heights) - Math.min(...heights) < 1e-9, "no zoom pumping with each rep");
  const crop = settled[settled.length - 1];
  assert.ok(crop.y < 0.35 && crop.y + crop.h > 0.75, "standing and squatting both fit");
  assert.ok(zoomOf(crop, 16 / 9, 16 / 9) > 1.5, "and the member is shown large");
});

test("with nobody in view the whole picture comes back, so they can find themselves", () => {
  const framer = new AutoFramer({ easeMs: 0 });
  framer.update(person(0.5, 0.45, 0.7), 0, 16 / 9, 16 / 9, STANDING, true);
  const soon = framer.update(null, 500, 16 / 9, 16 / 9, STANDING, true);
  assert.ok(soon.crop.h < 1, "a moment's loss keeps the framing");
  const later = framer.update(null, 5000, 16 / 9, 16 / 9, STANDING, true);
  assert.deepEqual(later.crop, { x: 0, y: 0, w: 1, h: 1 });
  assert.equal(later.assessment.issue, "no-body");
});

test("the crop glides to a new framing rather than jumping", () => {
  const glide = new AutoFramer({ easeMs: 500, maxZoom: 3 });
  glide.update(null, 0, 16 / 9, 16 / 9, STANDING, true);
  const first = glide.update(person(0.5, 0.45, 0.7), 33, 16 / 9, 16 / 9, STANDING, true).crop;
  assert.ok(first.h > 0.6, "barely moved after one frame");
  let crop = first;
  for (let t = 66; t < 4000; t += 33) crop = glide.update(person(0.5, 0.45, 0.7), t, 16 / 9, 16 / 9, STANDING, true).crop;
  assert.ok(crop.h < 0.5, "arrived within a few seconds");
});

test("zoom is capped by the camera's own resolution", () => {
  assert.equal(maxZoomFor(2160, 1000), 3, "4K on a phone: up to 3x");
  assert.ok(Math.abs(maxZoomFor(1080, 1000) - 2.16) < 1e-9);
  assert.equal(maxZoomFor(480, 1000), 1.5, "a small picture zooms only a little");
  assert.equal(maxZoomFor(0, 1000), 1);
});

test("the transform puts the crop exactly over the view", () => {
  assert.equal(cropTransform({ x: 0, y: 0, w: 1, h: 1 }, 400, 300, 400, 300), "translate3d(0.00px, 0.00px, 0) scale(1.0000)");
  assert.equal(cropTransform({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 400, 300, 400, 300), "translate3d(-200.00px, -150.00px, 0) scale(2.0000)");
});
