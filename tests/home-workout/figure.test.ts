import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMONSTRATIONS } from "@/lib/home-workout/demos";
import { BONES, blendPose, demoBounds, easeInOut, FLOOR_Y, jointOf, loopDuration, sampleDemo } from "@/lib/home-workout/figure";

const length = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test("limbs keep their length however a demonstration blends", () => {
  for (const [id, demo] of Object.entries(DEMONSTRATIONS)) {
    const loop = loopDuration(demo);
    for (let t = 0; t < loop; t += loop / 23) {
      const { points } = sampleDemo(demo, t);
      for (const side of [points.near, points.far]) {
        // Segments without a foreshortening scale in any keyframe keep their exact length.
        const scaled = demo.keyframes.some((frame) => frame.pose.near.scale?.upperArm || frame.pose.far.scale?.upperArm);
        if (!scaled) assert.ok(Math.abs(length(side.shoulder, side.elbow) - BONES.upperArm) < 1e-6, `${id}: upper arm`);
        assert.ok(Math.abs(length(side.knee, side.ankle) - BONES.shin) < 1e-6, `${id}: shin`);
      }
    }
  }
});

test("the anchor joint stays where the demonstration puts it, and the drawing's frame holds the whole loop", () => {
  for (const [id, demo] of Object.entries(DEMONSTRATIONS)) {
    const loop = loopDuration(demo);
    const box = demoBounds(demo);
    assert.ok(Math.abs(box.width / box.height - 4 / 3) < 1e-9, `${id}: 4:3 frame`);
    assert.ok(box.y + box.height >= FLOOR_Y, `${id}: the floor is in the frame`);
    for (let t = 0; t < loop; t += loop / 17) {
      const frame = sampleDemo(demo, t);
      if (!demo.keyframes.some((keyframe) => keyframe.at)) {
        const anchor = jointOf(frame.points, demo.anchor);
        assert.ok(length(anchor, demo.at) < 1e-6, `${id}: anchor moved at ${t}`);
      }
      const all = [frame.points.head, ...Object.values(frame.points.near), ...Object.values(frame.points.far)];
      for (const p of all) assert.ok(p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height, `${id}: out of frame at ${t} (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
    }
  }
});

test("poses blend the short way round and ease from rest to rest", () => {
  const a = DEMONSTRATIONS.push_up.keyframes[0].pose;
  const b = { ...a, torso: 350 };
  const mid = blendPose({ ...a, torso: 10 }, b, 0.5);
  assert.ok(Math.abs(((mid.torso % 360) + 360) % 360) < 1e-9 || Math.abs(mid.torso - 360) < 1e-9);
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.ok(Math.abs(easeInOut(0.5) - 0.5) < 1e-9);
});

test("the loop wraps, and every moment has a caption", () => {
  const demo = DEMONSTRATIONS.bodyweight_squat;
  const loop = loopDuration(demo);
  assert.deepEqual(sampleDemo(demo, 123).points, sampleDemo(demo, 123 + loop).points);
  for (let t = 0; t < loop; t += 100) assert.ok(sampleDemo(demo, t).label);
});
