# Pose model and runtime for the FITX camera coach

FITX serves these files itself, so the camera coach loads nothing from third parties at runtime.
Camera frames are processed on the user's device by this model; no image, video or body
landmark is uploaded or stored. Only rep counts and hold times leave the coach.

| File | Source | Licence | SHA-256 |
|---|---|---|---|
| `wasm-0.10.35/vision_wasm_internal.js` | npm `@mediapipe/tasks-vision@0.10.35`, `wasm/` | Apache-2.0 | `e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c` |
| `wasm-0.10.35/vision_wasm_internal.wasm` | npm `@mediapipe/tasks-vision@0.10.35`, `wasm/` | Apache-2.0 | `6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc` |
| `landmarker-float16-v1/pose_landmarker_lite.task` | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` | Apache-2.0 | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `landmarker-float16-v1/pose_landmarker_full.task` | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task` | Apache-2.0 | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` |

Copyright 2023 The MediaPipe Authors. Licensed under the Apache License, Version 2.0; see
`LICENSE-Apache-2.0.txt` in this folder. Models and model cards:
https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker

## Why version 0.10.35

From 1.0 (July 2026), `@mediapipe/tasks-vision` sends usage metrics to Google
(`odml.pa.googleapis.com`) every minute by default, and its README asks apps to obtain user
consent for that. 0.10.35 (April 2026) has the same Pose Landmarker API and no such code.
`tests/form-rules/pose-assets.test.ts` fails if a future upgrade brings it in.

## Upgrading

1. `npm install --save-exact @mediapipe/tasks-vision@<version>` and check its bundle sends nothing off the device.
2. Copy `node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.{js,wasm}` into a new `wasm-<version>/` folder
   (a new folder, so browsers never mix an old runtime with a new bundle), and delete the old folder.
3. Update `TASKS_VISION_VERSION` and `wasmBytes` in `src/lib/pose/assets.ts` and the checksums above.
4. Run `npm test`: `tests/form-rules/pose-assets.test.ts` checks that all of these agree.
