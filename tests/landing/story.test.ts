import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BONES, EXAMPLE_PLAN, POSE_FRAME, SQUAT_POSES, bonesPath, cueAt, frameAt, jointsPath, kneeAngle, kneeArcPath, manFrameAt, planDoneAt, poseAt, ramp, repsAt, squatDepth,
} from "@/components/landing/story";

const shape = (d: string) => d.replace(/-?\d+(\.\d+)?/g, "n");

test("the scene starts standing and ends at the bottom of the squat, so the reduced-motion frame (progress 1) shows depth", () => {
  assert.equal(squatDepth(0), 0);
  assert.equal(squatDepth(1), 1);
  assert.ok(Math.abs(squatDepth(1 / 3) - 1) < 1e-9, "first bottom a third of the way");
  assert.ok(squatDepth(2 / 3) < 1e-9, "standing again at two thirds");
  assert.equal(frameAt(squatDepth(0)), 0);
  assert.equal(frameAt(squatDepth(1)), 2);
  assert.equal(cueAt(1), "Good depth");
});

test("depth stays in range and progress outside 0..1 or NaN is clamped", () => {
  for (let p = -0.5; p <= 1.5; p += 0.01) {
    const depth = squatDepth(p);
    assert.ok(depth >= 0 && depth <= 1, `depth ${depth} at ${p}`);
  }
  assert.equal(squatDepth(Number.NaN), 0);
});

test("reps count each bottom reached: none at the start, two at the end", () => {
  assert.equal(repsAt(0), 0);
  assert.equal(repsAt(0.32), 0);
  assert.equal(repsAt(0.34), 1);
  assert.equal(repsAt(0.99), 1);
  assert.equal(repsAt(1), 2);
});

test("the skeleton keeps the same path commands for every depth, so it morphs instead of jumping", () => {
  const shapes = new Set([0, 0.25, 0.5, 0.75, 1].map((d) => shape(bonesPath(poseAt(d)))));
  assert.equal(shapes.size, 1);
  assert.equal(new Set([0, 0.5, 1].map((d) => shape(jointsPath(poseAt(d))))).size, 1);
  assert.equal(new Set([0, 0.5, 1].map((d) => shape(kneeArcPath(poseAt(d))))).size, 1);
  assert.equal(bonesPath(poseAt(0)).split("M").length - 1, BONES.length);
});

test("the measured poses sit inside the photo frame and blend exactly onto the measured frames", () => {
  for (const pose of SQUAT_POSES) {
    for (const [x, y] of Object.values(pose)) {
      assert.ok(x >= 0 && x <= POSE_FRAME.width && y >= 0 && y <= POSE_FRAME.height, `${x},${y}`);
    }
  }
  assert.deepEqual(poseAt(0), SQUAT_POSES[0]);
  assert.deepEqual(poseAt(0.5), SQUAT_POSES[1]);
  assert.deepEqual(poseAt(1), SQUAT_POSES[2]);
});

test("the knee angle closes as she squats and reads like a real squat", () => {
  const standing = kneeAngle(poseAt(0));
  const bottom = kneeAngle(poseAt(1));
  assert.ok(standing > 150, `standing knee ${standing}°`);
  assert.ok(bottom < 120 && bottom > 50, `bottom knee ${bottom}°`);
  assert.ok(bottom < kneeAngle(poseAt(0.5)));
});

test("cues follow the rep: set-up, down, depth, up", () => {
  assert.equal(cueAt(0), "Feet shoulder-width");
  assert.equal(cueAt(0.15), "Sit back, chest up");
  assert.equal(cueAt(1 / 3), "Good depth");
  assert.equal(cueAt(0.5), "Drive through your heels");
});

test("the plan ticks off row by row and is complete in the final frame", () => {
  assert.equal(planDoneAt(0), 0);
  assert.equal(planDoneAt(0.5), 1);
  assert.equal(planDoneAt(1), EXAMPLE_PLAN.length);
  let last = 0;
  for (let p = 0; p <= 1; p += 0.01) {
    const done = planDoneAt(p);
    assert.ok(done >= last && done <= EXAMPLE_PLAN.length);
    last = done;
  }
  assert.equal(manFrameAt(0), 0, "reading his plan first");
  assert.equal(manFrameAt(1), 1, "lifting at the end");
});

test("ramp clamps outside its range and maps linearly inside", () => {
  assert.equal(ramp(0, 0.02, 0.12, 0, 1), 0);
  assert.equal(ramp(1, 0.02, 0.12, 0, 1), 1);
  assert.ok(Math.abs(ramp(0.07, 0.02, 0.12, 0, 1) - 0.5) < 1e-9);
  assert.equal(ramp(0.5, 0, 0.7, 1, 0) < 1, true);
  assert.equal(ramp(Number.NaN, 0, 1, 2, 3), 2);
});

test("scroll-linked opacity uses function transforms, never ranges framer would hand to a ScrollTimeline", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../../src/components/landing/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".tsx"))) {
    const source = readFileSync(new URL(file, dir), "utf8");
    assert.doesNotMatch(source, /useTransform\([^,()]+,\s*\[/, `${file} uses a range-based useTransform`);
  }
});
