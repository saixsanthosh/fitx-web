// The pure parts of the framing check (BRIEF-2 3.2): what a viewer sees of each composition at the real edges of the
// bands it serves, the protected box, and projection through the film's own camera code (camera.ts). The lab's
// `project()` applies the same functions to each shot's `subjects()` at render time (verify.mjs --framing).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { COMPOSITIONS, type FilmComposition } from "@/components/brand/films/compositions";
import { applyCameraState, createCameraState, evaluateCameraTrack, type CameraTrack } from "@/components/brand/intro/director/camera";
import {
  PROTECT_MARGIN,
  boxFromNdc,
  framingFailures,
  framingFrames,
  inside,
  protectedBox,
  servedEdges,
  visibleRegion,
} from "../../scripts/brand/films/lib/framing.mjs";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test("cover fit: a narrower viewport crops the width, a wider one the height, by the table's worst crops", () => {
  for (const band of COMPOSITIONS) {
    const atMin = visibleRegion(band.aspect, band.checkMin);
    const atMax = visibleRegion(band.aspect, band.checkMax);
    const lostAtMin = band.worstCrop.atMin.axis === "width" ? 1 - (atMin.x1 - atMin.x0) : 1 - (atMin.y1 - atMin.y0);
    const lostAtMax = band.worstCrop.atMax.axis === "width" ? 1 - (atMax.x1 - atMax.x0) : 1 - (atMax.y1 - atMax.y0);
    assert.ok(Math.abs(lostAtMin - band.worstCrop.atMin.share) <= 0.006, `${band.id} at ${band.checkMin}: ${lostAtMin}`);
    assert.ok(Math.abs(lostAtMax - band.worstCrop.atMax.share) <= 0.006, `${band.id} at ${band.checkMax}: ${lostAtMax}`);
  }
  assert.deepEqual(visibleRegion(16 / 9, 16 / 9), { x0: 0, y0: 0, x1: 1, y1: 1 });
});

test("the protected box: visible at both edges of the band, shrunk by 9% on each side (the 82% rule)", () => {
  assert.equal(PROTECT_MARGIN, 0.09);
  const laptop = protectedBox("laptop");
  const width = 1.54 / (16 / 9);
  const height = (16 / 9) / 1.89;
  assert.ok(close(laptop.x1 - laptop.x0, width * 0.82, 1e-9), "82% of the width visible at 1.54");
  assert.ok(close(laptop.y1 - laptop.y0, height * 0.82, 1e-9), "82% of the height visible at 1.89");
  assert.ok(close(laptop.x0 + laptop.x1, 1) && close(laptop.y0 + laptop.y1, 1), "centred");
  for (const band of COMPOSITIONS) {
    const box = protectedBox(band.id);
    for (const edge of [band.checkMin, band.checkMax]) assert.ok(inside(box, visibleRegion(band.aspect, edge)), `${band.id} box visible at ${edge}`);
  }
  // The phone frame is the hardest: checked from 0.42.
  const phone = protectedBox("phone");
  assert.ok(phone.x1 - phone.x0 < 0.7);
});

test("served edges: each composition its own band; a film without laptop serves that band from its nearest", () => {
  assert.deepEqual(servedEdges("laptop"), [1.54, 1.89]);
  const withoutLaptop: FilmComposition[] = ["phone", "tablet-p", "tablet-l", "desktop"];
  const desktopEdges = servedEdges("desktop", withoutLaptop);
  const tabletEdges = servedEdges("tablet-l", withoutLaptop);
  const laptopBand = COMPOSITIONS.find((band) => band.id === "laptop")!;
  const served = [...desktopEdges, ...tabletEdges];
  assert.ok(served.includes(laptopBand.checkMin) && served.includes(laptopBand.checkMax), "the laptop band is still checked at its real edges");
  // Serving more bands can only shrink the protected box.
  const own = protectedBox("desktop");
  const wider = protectedBox("desktop", withoutLaptop);
  assert.ok(inside(wider, own));
});

test("projection through camera.ts: a subject at the look-at point lands in the centre at every band edge", () => {
  const track: CameraTrack = { keys: [{ t: 0, position: [0, 1.6, 6], target: [0, 1, 0], focal: 35 }] };
  const state = createCameraState();
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.02, 600);
  camera.filmGauge = 36;
  const corner = new THREE.Vector3();
  for (const band of COMPOSITIONS) {
    for (const aspect of [band.checkMin, band.aspect, band.checkMax]) {
      evaluateCameraTrack(track, 0, aspect, state);
      applyCameraState(camera, state, aspect);
      camera.updateMatrixWorld();
      const ndc: [number, number, number][] = [];
      for (const x of [-0.2, 0.2]) for (const y of [0.8, 1.2]) for (const z of [-0.2, 0.2]) {
        corner.set(x, y, z).project(camera);
        ndc.push([corner.x, corner.y, corner.z]);
      }
      const box = boxFromNdc(ndc);
      assert.ok(box, `${band.id} ${aspect}: in front of the camera`);
      assert.ok(close((box!.x0 + box!.x1) / 2, 0.5, 1e-6), `${band.id} ${aspect}: centred horizontally`);
      assert.ok(inside(box!, protectedBox(band.id)), `${band.id} ${aspect}: inside the protected box`);
    }
  }
  // Behind the camera: no box (verify reports it rather than reading nonsense coordinates).
  assert.equal(boxFromNdc([[0, 0, 1.2]]), null);
});

test("framing failures: outside the box, behind the camera, under a zone; optional subjects never fail", () => {
  const box = protectedBox("laptop");
  const centre = { x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 };
  const edge = { x0: 0.0, y0: 0.45, x1: 0.05, y1: 0.55 };
  const failures = framingFailures({
    comp: "laptop",
    subjects: [
      { id: "maya", must: true, box: centre },
      { id: "leo", must: true, box: edge },
      { id: "dre", must: true, box: null },
      { id: "bleachers", must: false, box: edge },
    ],
    zones: [{ id: "pace-callout", box: { x0: 0.5, y0: 0.5, x1: 0.9, y1: 0.9 } }],
  });
  assert.deepEqual(failures.map((failure: { id: string; problem: string }) => `${failure.id}: ${failure.problem}`), [
    "maya: under pace-callout",
    "leo: outside the protected box",
    "dre: behind the camera",
  ]);
  assert.ok(inside(centre, box));
});

test("the frames framing checks: every 6th frame and each cut ± 1", () => {
  const film = { duration: 1, shots: [{ start: 0 }, { start: 0.5 }] };
  assert.deepEqual(framingFrames(film), [0, 1, 6, 12, 18, 24, 29, 30, 31, 36, 42, 48, 54]);
});
