import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_POSES, POSE_MS, bodyPath, poseIndexAt } from "@/components/layout/ActivityNavIcon";

const shape = (d: string) => d.replace(/-?\d+(\.\d+)?/g, "n");

test("the Activity icon loops walking, running and cycling", () => {
  assert.deepEqual(ACTIVITY_POSES.map(({ name }) => name), ["walk", "run", "ride"]);
  assert.equal(POSE_MS, 1200);
  assert.equal(poseIndexAt(0), 0);
  assert.equal(poseIndexAt(1199), 0);
  assert.equal(poseIndexAt(1200), 1);
  assert.equal(poseIndexAt(2400), 2);
  assert.equal(poseIndexAt(3600), 0, "back to walking");
});

test("every pose has the same path commands, so the figure morphs instead of jumping", () => {
  const shapes = new Set(ACTIVITY_POSES.map((pose) => shape(bodyPath(pose))));
  assert.equal(shapes.size, 1);
});

test("every point sits inside the 24 px grid", () => {
  for (const pose of ACTIVITY_POSES) {
    const numbers = bodyPath(pose).match(/-?\d+(\.\d+)?/g)!.map(Number).concat(pose.head);
    assert.ok(numbers.every((n) => n >= 1 && n <= 23), pose.name);
  }
});
