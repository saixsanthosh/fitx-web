/**
 * The pose model and its WebAssembly runtime are served from FITX itself (public/models/pose),
 * so the camera coach loads nothing from third parties. Paths carry versions, so a future
 * upgrade gets new URLs instead of mixing old and new files in a browser cache.
 *
 * The runtime must match the installed @mediapipe/tasks-vision package exactly;
 * tests/form-rules/pose-assets.test.mjs fails if they drift. See public/models/pose/NOTICE.md.
 */
export const TASKS_VISION_VERSION = "0.10.35";

export const POSE_ASSETS = {
  wasmLoader: `/models/pose/wasm-${TASKS_VISION_VERSION}/vision_wasm_internal.js`,
  wasmBinary: `/models/pose/wasm-${TASKS_VISION_VERSION}/vision_wasm_internal.wasm`,
  wasmBytes: 11_153_617,
  models: {
    lite: { path: "/models/pose/landmarker-float16-v1/pose_landmarker_lite.task", bytes: 5_777_746 },
    full: { path: "/models/pose/landmarker-float16-v1/pose_landmarker_full.task", bytes: 9_398_198 },
  },
} as const;

/** Megabytes downloaded the first time the coach starts with this model. */
export function firstLoadMegabytes(model: keyof typeof POSE_ASSETS.models): number {
  return Math.round((POSE_ASSETS.wasmBytes + POSE_ASSETS.models[model].bytes) / 1_000_000);
}
