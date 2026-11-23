// camera.ts's compositions (BRIEF-2 3.2): each composition is the frame its cut renders at its own aspect; any other
// viewport in the band sees exactly that frame's cover-fit crop; neighbouring compositions blend only around a band
// boundary; above 16:9 the lens widens to keep 16:9's vertical coverage (at most ×1.3); tracks without
// `compositions` behave as they always did.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { COMPOSITIONS } from "@/components/brand/films/compositions";
import {
  BASE_ASPECT,
  COMPOSITION_BLEND,
  WIDE_FOCAL_CAP,
  applyCameraState,
  compositionWeights,
  coverZoom,
  createCameraState,
  evaluateCameraTrack,
  evaluateComposition,
  wideFocalFactor,
  type CameraTrack,
} from "@/components/brand/intro/director/camera";

const keys: CameraTrack["keys"] = [
  { t: 0, position: [0.4, 1.5, 6], target: [0, 1.1, 0], focal: 35, ease: "inOut" },
  { t: 1, position: [-0.3, 1.6, 5.2], target: [0.1, 1.2, 0], focal: 40 },
];
const portraitKeys: CameraTrack["keys"] = [
  { t: 0, position: [0.2, 1.7, 7], target: [0, 1.3, 0], focal: 30, ease: "inOut" },
  { t: 1, position: [-0.2, 1.8, 6.4], target: [0.05, 1.35, 0], focal: 32 },
];
const composed: CameraTrack = {
  keys,
  portrait: { keys: portraitKeys },
  compositions: {
    phone: {},
    "tablet-p": { keys: portraitKeys, focalScale: 1.1 },
    "tablet-l": { focalScale: 0.94, offset: [0.1, -0.05, 0] },
    laptop: {},
    desktop: { offset: [0, 0.05, 0.2] },
  },
};

const camera = new THREE.PerspectiveCamera(35, BASE_ASPECT, 0.02, 600);
function project(track: CameraTrack, t: number, aspect: number, point: THREE.Vector3) {
  const state = evaluateCameraTrack(track, t, aspect, createCameraState());
  applyCameraState(camera, state, aspect);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return point.clone().project(camera);
}
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test("compositionWeights: one composition inside a band, two around each boundary, half and half on it", () => {
  for (const band of COMPOSITIONS) {
    const weights = compositionWeights(band.aspect);
    assert.deepEqual(weights, [{ comp: band.id, weight: 1 }], band.id);
  }
  for (let index = 0; index < COMPOSITIONS.length - 1; index += 1) {
    const boundary = COMPOSITIONS[index].max;
    const on = compositionWeights(boundary);
    assert.equal(on.length, 2);
    assert.equal(on[0].comp, COMPOSITIONS[index].id);
    assert.equal(on[1].comp, COMPOSITIONS[index + 1].id);
    assert.ok(close(on[0].weight, 0.5) && close(on[1].weight, 0.5));
    const outside = Math.exp(COMPOSITION_BLEND * 1.01);
    assert.equal(compositionWeights(boundary / outside).length, 1);
    assert.equal(compositionWeights(boundary * outside).length, 1);
    // The weight rises monotonically and continuously across the blend.
    let previous = 0;
    for (let step = -20; step <= 20; step += 1) {
      const weights = compositionWeights(boundary * Math.exp((step / 20) * COMPOSITION_BLEND * 0.999));
      const wider = weights.find((entry) => entry.comp === COMPOSITIONS[index + 1].id)?.weight ?? 0;
      assert.ok(wider >= previous - 1e-12 && wider - previous < 0.12, `${boundary} step ${step}`);
      assert.ok(close(weights.reduce((sum, entry) => sum + entry.weight, 0), 1));
      previous = wider;
    }
  }
  assert.deepEqual(compositionWeights(Number.NaN), [{ comp: "laptop", weight: 1 }]);
});

test("wide lens above 16:9, capped at ×1.3; none at or below 16:9", () => {
  assert.equal(wideFocalFactor(BASE_ASPECT), 1);
  assert.equal(wideFocalFactor(1.2), 1);
  assert.ok(close(wideFocalFactor(2), 2 / BASE_ASPECT));
  assert.equal(wideFocalFactor(3), WIDE_FOCAL_CAP);
  const legacy: CameraTrack = { keys };
  const state = evaluateCameraTrack(legacy, 0.5, 2, createCameraState());
  const base = evaluateCameraTrack(legacy, 0.5, BASE_ASPECT, createCameraState());
  assert.ok(close(state.focal, base.focal / (2 / BASE_ASPECT)), "a 2:1 frame keeps 16:9's vertical coverage");
  // Vertical field of view at 2:1 equals the 16:9 one.
  const fov = (focal: number, aspect: number) => 2 * Math.atan(36 / Math.max(aspect, 1) / 2 / focal);
  assert.ok(close(fov(state.focal, 2), fov(base.focal, BASE_ASPECT), 1e-12));
});

test("a track without compositions is evaluated exactly as before (16:9 and portrait)", () => {
  const legacy: CameraTrack = { keys, portrait: { keys: portraitKeys, focalScale: 0.9, distanceScale: 1.1 } };
  const at169 = evaluateCameraTrack(legacy, 0, BASE_ASPECT, createCameraState());
  assert.deepEqual(at169.position.toArray(), keys[0].position);
  assert.equal(at169.focal, 35);
  const phone = evaluateCameraTrack(legacy, 0, 0.5, createCameraState());
  // Full portrait weight at 0.5 (smoothstep from 1 to 0.56): focal ×0.9, distance ×1.1 from the target.
  assert.ok(close(phone.focal, 30 * 0.9, 1e-9));
  const expected = new THREE.Vector3(...portraitKeys[0].position).sub(new THREE.Vector3(...portraitKeys[0].target)).multiplyScalar(1.1).add(new THREE.Vector3(...portraitKeys[0].target));
  assert.ok(phone.position.distanceTo(expected) < 1e-9);
});

test("each composition holds its own frame at its render aspect (laptop as keyed, phone on the portrait keys)", () => {
  const laptop = evaluateCameraTrack(composed, 0, 16 / 9, createCameraState());
  assert.deepEqual(laptop.position.toArray(), keys[0].position);
  assert.equal(laptop.focal, 35);
  const phone = evaluateCameraTrack(composed, 0, 0.5, createCameraState());
  assert.deepEqual(phone.position.toArray(), portraitKeys[0].position, "phone falls back to `portrait.keys`");
  assert.equal(phone.focal, 30);
  const tabletP = evaluateCameraTrack(composed, 0, 0.75, createCameraState());
  assert.ok(close(tabletP.focal, 30 * 1.1));
  const desktop = evaluateCameraTrack(composed, 0, 2, createCameraState());
  assert.ok(close(desktop.focal, 35 / (2 / BASE_ASPECT)), "desktop widens to keep 16:9's height");
  for (const band of COMPOSITIONS) {
    const direct = evaluateComposition(composed, band.id, 0.4, band.aspect, createCameraState());
    const viaTrack = evaluateCameraTrack(composed, 0.4, band.aspect, createCameraState());
    assert.ok(direct.position.distanceTo(viaTrack.position) < 1e-12 && close(direct.focal, viaTrack.focal), band.id);
  }
});

test("offset moves lens and target together along the frame's own axes", () => {
  const plain = evaluateComposition({ keys, compositions: { "tablet-l": {} } }, "tablet-l", 0, 4 / 3, createCameraState());
  const moved = evaluateComposition(composed, "tablet-l", 0, 4 / 3, createCameraState());
  const shift = moved.position.clone().sub(plain.position);
  assert.ok(shift.distanceTo(moved.target.clone().sub(plain.target)) < 1e-12, "a truck, not a pan");
  assert.ok(close(shift.length(), Math.hypot(0.1, 0.05), 1e-9));
  // A world point at the old target moves left and up on screen when the frame trucks right and drops.
  const point = plain.target.clone();
  const ndc = project({ keys, compositions: { "tablet-l": { focalScale: 0.94, offset: [0.1, -0.05, 0] } } }, 0, 4 / 3, point);
  assert.ok(ndc.x < 0 && ndc.y > 0, JSON.stringify(ndc));
});

test("inside a band the live frame is the cut's cover-fit crop: points land where the cover fit puts them", () => {
  assert.equal(coverZoom(1.5, 1.5), 1);
  const points = [new THREE.Vector3(0.3, 1.0, 0.2), new THREE.Vector3(-0.4, 1.6, -0.5), new THREE.Vector3(0.1, 0.4, 0.6)];
  for (const band of COMPOSITIONS) {
    const edges = [band.checkMin, band.checkMax].map((edge) => (edge === band.max ? edge * Math.exp(-COMPOSITION_BLEND * 1.5) : edge * (edge === band.min ? Math.exp(COMPOSITION_BLEND * 1.5) : 1)));
    for (const view of edges) {
      for (const point of points) {
        const frame = project(composed, 0.3, band.aspect, point);
        const live = project(composed, 0.3, view, point);
        // Cover fit: a narrower screen keeps the frame's height (x scales up by A/a), a wider one its width.
        const ex = view < band.aspect ? frame.x * (band.aspect / view) : frame.x;
        const ey = view < band.aspect ? frame.y : frame.y * (view / band.aspect);
        assert.ok(close(live.x, ex, 1e-6) && close(live.y, ey, 1e-6), `${band.id} at ${view.toFixed(3)}: ${live.x},${live.y} vs ${ex},${ey}`);
      }
    }
  }
});

test("resizing across a boundary never jumps (the live film stays continuous)", () => {
  for (let index = 0; index < COMPOSITIONS.length - 1; index += 1) {
    const boundary = COMPOSITIONS[index].max;
    let previous = evaluateCameraTrack(composed, 0.5, boundary * Math.exp(-COMPOSITION_BLEND * 1.2), createCameraState());
    for (let step = -11; step <= 12; step += 1) {
      const aspect = boundary * Math.exp((step / 10) * COMPOSITION_BLEND);
      const state = evaluateCameraTrack(composed, 0.5, aspect, createCameraState());
      assert.ok(state.position.distanceTo(previous.position) < 0.25, `${boundary} step ${step}`);
      assert.ok(Math.abs(Math.log(state.focal / previous.focal)) < 0.2, `${boundary} focal step ${step}`);
      previous = state;
    }
  }
});
