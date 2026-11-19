import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cameraProblem, cameraTuning, createReadConsensus, focusConstraints, focusPoint, pickRearCamera, readStateText, scanRegion, scannerConstraints, snapZoom,
} from "@/lib/food/scanner";

test("the scanner asks for a high-resolution rear camera with continuous focus", () => {
  const video = scannerConstraints().video as MediaTrackConstraints & { advanced: unknown[] };
  assert.deepEqual(video.facingMode, { ideal: "environment" });
  assert.deepEqual(video.width, { ideal: 1920 });
  assert.deepEqual(video.height, { ideal: 1080 });
  assert.deepEqual(video.advanced, [{ focusMode: "continuous" }]);
  const exact = scannerConstraints("cam-0").video as MediaTrackConstraints;
  assert.deepEqual(exact.deviceId, { exact: "cam-0" });
  assert.equal(exact.facingMode, undefined);
});

test("the main rear lens is chosen over the ultra-wide one", () => {
  const devices = [
    { deviceId: "f", label: "camera2 1, facing front", kind: "videoinput" },
    { deviceId: "w", label: "camera2 2, facing back (ultra wide)", kind: "videoinput" },
    { deviceId: "b", label: "camera2 0, facing back", kind: "videoinput" },
    { deviceId: "m", label: "Microphone", kind: "audioinput" },
  ];
  assert.equal(pickRearCamera(devices), "b");
  assert.equal(pickRearCamera([{ deviceId: "x", label: "Back Camera", kind: "videoinput" }]), null, "one rear camera: let the browser choose");
  assert.equal(pickRearCamera([{ deviceId: "", label: "", kind: "videoinput" }, { deviceId: "", label: "", kind: "videoinput" }]), null, "no labels before permission");
  assert.equal(pickRearCamera([
    { deviceId: "u", label: "Back Ultra Wide Camera", kind: "videoinput" },
    { deviceId: "t", label: "Back Telephoto Camera", kind: "videoinput" },
  ]), null, "no main lens among them");
});

test("tuning turns on continuous focus, starts at 1.5x zoom and finds the torch", () => {
  const tuning = cameraTuning({ focusMode: ["manual", "single-shot", "continuous"], zoom: { min: 1, max: 8, step: 0.1 }, torch: true }, { pointsOfInterest: true });
  assert.equal(tuning.continuousFocus, true);
  assert.equal(tuning.tapToFocus, true);
  assert.equal(tuning.torch, true);
  assert.equal(tuning.startZoom, 1.5);
  assert.deepEqual(tuning.apply, [{ focusMode: "continuous", zoom: 1.5 }]);
});

test("a camera that reports nothing is left alone", () => {
  const tuning = cameraTuning({}, {});
  assert.deepEqual(tuning, { apply: [], continuousFocus: false, tapToFocus: false, zoom: null, startZoom: null, torch: false });
  assert.equal(cameraTuning(null).zoom, null);
  assert.equal(cameraTuning({ zoom: { min: 1, max: 1.6 } }).startZoom, null, "too little zoom to bother");
  assert.equal(cameraTuning({ focusMode: ["continuous"] }, {}).tapToFocus, false, "no pointsOfInterest: no tap to focus");
});

test("zoom snaps to the camera's own steps and range", () => {
  assert.equal(snapZoom(1.53, { min: 1, max: 4, step: 0.25 }), 1.5);
  assert.equal(snapZoom(9, { min: 1, max: 4, step: 0.25 }), 4);
  assert.equal(snapZoom(0.2, { min: 1, max: 4, step: 0.25 }), 1);
});

test("a tap is mapped through the cover crop onto the camera frame", () => {
  const box = { left: 10, top: 20, width: 400, height: 300 };
  // A 1920x1080 frame in a 400x300 box is scaled to 533x300, so 66.7 px is cut off each side.
  assert.deepEqual(focusPoint({ x: 210, y: 170 }, box, { width: 1920, height: 1080 }), { x: 0.5, y: 0.5 });
  assert.deepEqual(focusPoint({ x: 10, y: 20 }, box, { width: 1920, height: 1080 }), { x: 0.125, y: 0 });
  assert.deepEqual(focusPoint({ x: -500, y: 900 }, box, { width: 1920, height: 1080 }), { x: 0, y: 1 }, "clamped");
  assert.equal(focusPoint({ x: 0, y: 0 }, box, { width: 0, height: 0 }), null);
  assert.deepEqual(focusConstraints({ x: 0.5, y: 0.5 }, ["continuous", "single-shot"]), { pointsOfInterest: [{ x: 0.5, y: 0.5 }], focusMode: "single-shot" });
  assert.equal((focusConstraints({ x: 0, y: 0 }, ["continuous"]) as { focusMode: string }).focusMode, "continuous");
});

test("only the scan window (with a margin) is read", () => {
  const region = scanRegion({ width: 1920, height: 1080 }, { width: 400, height: 300 }, { left: 0.1, right: 0.1, top: 0.3, bottom: 0.3 }, 0);
  // View x 40..360 maps to frame (40+66.67)/0.2778 .. (360+66.67)/0.2778 = 384..1536; y 90..210 maps to 324..756.
  assert.deepEqual(region, { x: 384, y: 324, width: 1152, height: 432 });
  const withMargin = scanRegion({ width: 1920, height: 1080 }, { width: 400, height: 300 });
  assert.ok(withMargin && withMargin.width > 1000 && withMargin.x >= 0 && withMargin.x + withMargin.width <= 1920);
  assert.equal(scanRegion({ width: 0, height: 0 }, { width: 400, height: 300 }), null);
});

test("a code counts after two matching reads in time; a different code starts over", () => {
  const reads = createReadConsensus(2, 1500);
  assert.equal(reads.state(0), "searching");
  assert.deepEqual(reads.push("8901063010031", 0), { state: "steady", code: "8901063010031" });
  assert.equal(reads.state(100), "steady");
  assert.deepEqual(reads.push("5000112637922", 200), { state: "steady", code: "5000112637922" }, "a misread restarts the count");
  assert.equal(reads.push("5000112637922", 400).state, "confirmed");
  reads.reset();
  reads.push("8901063010031", 0);
  assert.equal(reads.push("8901063010031", 2000).state, "steady", "too far apart");
  assert.equal(reads.state(5000), "searching", "reads stopped");
});

test("the scanner's words", () => {
  assert.match(readStateText("searching"), /frame/);
  assert.match(readStateText("steady"), /steady/);
  assert.match(readStateText("confirmed"), /Got it/);
  for (const name of ["NotAllowedError", "NotFoundError", "NotReadableError", "Other"]) assert.match(cameraProblem(name), /type the number/);
});
