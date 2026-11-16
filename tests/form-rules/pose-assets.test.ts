/**
 * Guards the self-hosted pose model and runtime: the files exist, match the sizes the loader
 * reports, match the installed @mediapipe/tasks-vision exactly (a mismatched runtime fails at
 * start-up in the browser), and the pinned package has no code that phones home.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { POSE_ASSETS, TASKS_VISION_VERSION } from "@/lib/pose/assets";

const ROOT = path.resolve(import.meta.dirname, "../..");
const publicFile = (url: string) => path.join(ROOT, "public", url);
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const PACKAGE = path.join(ROOT, "node_modules/@mediapipe/tasks-vision");

test("the package is pinned to the exact runtime version FITX serves", () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  assert.equal(manifest.dependencies["@mediapipe/tasks-vision"], TASKS_VISION_VERSION);
  const installed = JSON.parse(readFileSync(path.join(PACKAGE, "package.json"), "utf8")) as { version: string };
  assert.equal(installed.version, TASKS_VISION_VERSION);
});

test("the served WebAssembly runtime is byte-for-byte the installed package's", () => {
  for (const [url, name] of [[POSE_ASSETS.wasmLoader, "vision_wasm_internal.js"], [POSE_ASSETS.wasmBinary, "vision_wasm_internal.wasm"]] as const) {
    assert.equal(sha256(publicFile(url)), sha256(path.join(PACKAGE, "wasm", name)), url);
  }
  assert.equal(statSync(publicFile(POSE_ASSETS.wasmBinary)).size, POSE_ASSETS.wasmBytes);
  const magic = readFileSync(publicFile(POSE_ASSETS.wasmBinary)).subarray(0, 4);
  assert.deepEqual([...magic], [0x00, 0x61, 0x73, 0x6d], "WebAssembly magic number");
});

test("both pose models are complete task bundles with the sizes and checksums in NOTICE.md", () => {
  const notice = readFileSync(path.join(ROOT, "public/models/pose/NOTICE.md"), "utf8");
  for (const model of Object.values(POSE_ASSETS.models)) {
    const file = publicFile(model.path);
    assert.equal(statSync(file).size, model.bytes, model.path);
    const bytes = readFileSync(file);
    assert.ok(bytes.includes(Buffer.from("pose_detector.tflite")) && bytes.includes(Buffer.from("pose_landmarks_detector.tflite")), `${model.path} holds both networks`);
    assert.ok(notice.includes(sha256(file)), `${model.path} checksum is recorded in NOTICE.md`);
  }
  for (const url of [POSE_ASSETS.wasmLoader, POSE_ASSETS.wasmBinary]) assert.ok(notice.includes(sha256(publicFile(url))), `${url} checksum is recorded in NOTICE.md`);
  const licence = readFileSync(path.join(ROOT, "public/models/pose/LICENSE-Apache-2.0.txt"), "utf8");
  assert.match(licence, /^Apache License\s+Version 2\.0, January 2004/);
  assert.match(licence, /END OF TERMS AND CONDITIONS/);
});

test("the pinned MediaPipe code sends nothing off the device", () => {
  // MediaPipe 1.x reports usage to Google every minute by default; FITX stays on 0.10.x, which does not.
  // ("type.googleapis.com/…" strings are protobuf type names, not addresses.)
  const telemetry = /odml\.pa\.googleapis|play\.googleapis\.com\/log|\/v1\/log\b|clearcut|firebaselogging|google-analytics/i;
  const bundle = readFileSync(path.join(PACKAGE, "vision_bundle.mjs"), "utf8");
  assert.doesNotMatch(bundle, telemetry);
  assert.doesNotMatch(bundle, /https?:\/\//, "the JavaScript bundle names no web address at all");
  assert.doesNotMatch(readFileSync(publicFile(POSE_ASSETS.wasmLoader), "utf8"), telemetry);
});
