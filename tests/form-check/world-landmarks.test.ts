import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { readFrame } from "@/lib/form-rules/metrics";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { PoseFrame, PosePoint } from "@/lib/pose/landmarks";
import { LANDMARK } from "@/lib/pose/landmarks";
import type { Body } from "../form-rules/synthetic";
import { cueIds, frameOf, planDuration, play, repValueAt, squat } from "../form-rules/synthetic";

const ASPECT = 3 / 4;
type Limb = Body["near"];

/**
 * A side-on body (square image units, x forward) turned `yaw` degrees towards the camera, seen by a
 * camera that projects it flat: the picture squashes everything along the body's forward direction by
 * cos(yaw), while the world landmarks keep true 3D positions (metres-like units, hips at the origin).
 */
export function turned(body: Body, yaw: number, t: number, withWorld: boolean): PoseFrame {
  const rad = (yaw * Math.PI) / 180;
  const hip = body.near.hip as { x: number; y: number };
  const half: Record<string, number> = { shoulder: 0.09, elbow: 0.11, wrist: 0.11, hip: 0.07, knee: 0.07, ankle: 0.07, heel: 0.07, foot: 0.07, nose: 0, ear: 0.04 };
  const place = (limb: Limb, side: 1 | -1) => {
    const image: Limb = {};
    const world: Limb = {};
    const depth: Limb = {};
    for (const [part, p] of Object.entries(limb) as Array<[keyof Limb, { x: number; y: number }]>) {
      const forward = p.x - hip.x;
      const across = side * (half[part as string] ?? 0.07);
      const x = forward * Math.cos(rad) + across * Math.sin(rad);
      const z = -forward * Math.sin(rad) + across * Math.cos(rad);
      image[part] = { x: 0.4 + x, y: p.y };
      world[part] = { x, y: p.y - hip.y };
      depth[part] = { x: z, y: 0 };
    }
    return { image, world, depth };
  };
  const near = place(body.near, 1);
  const far = place(body.near, -1);
  const frame = frameOf({ near: near.image, far: far.image, nearVisibility: 0.95, farVisibility: 0.85 }, t, { aspect: ASPECT });
  if (!withWorld) return frame;
  const xy = frameOf({ near: near.world, far: far.world, nearVisibility: 0.95, farVisibility: 0.85 }, t, { aspect: 1 });
  const z = frameOf({ near: near.depth, far: far.depth, nearVisibility: 0.95, farVisibility: 0.85 }, t, { aspect: 1 });
  const world: PosePoint[] = (xy.points ?? []).map((point, index) => ({ ...point, z: (z.points ?? [])[index]?.x ?? 0 }));
  return { ...frame, world };
}

const rule = getExerciseRule("bodyweight_squat") as ExerciseRule;

function squats(yaw: number, withWorld: boolean, depths = [100, 100, 100]) {
  const plan = { from: 172, depths, repMs: 2200, restMs: 900 };
  const frames: PoseFrame[] = [];
  for (let t = 0; t <= planDuration(plan); t += 1000 / 30) frames.push(turned(squat(repValueAt(plan, t)), yaw, 10_000 + t, withWorld));
  return play(createCoachSession(rule), frames);
}

test("turned 50° towards the camera, the flat picture squashes a full squat into a partial one", () => {
  const result = squats(50, false);
  assert.equal(result.last.reps, 0);
});

test("with world landmarks, the same squats at 50° are counted in full", () => {
  const result = squats(50, true);
  assert.equal(result.last.reps, 3);
  assert.ok(result.snapshots.some((snapshot) => snapshot.usedWorld), "3D was used for the angled view");
  assert.deepEqual(cueIds(result.events), []);
});

test("side-on, the picture's own angles are used even when world landmarks are there", () => {
  const plan = { from: 172, depths: [100], repMs: 2200 };
  const frame = turned(squat(repValueAt(plan, 1100 + 800)), 0, 0, true);
  const reading = readFrame(rule, frame, null);
  assert.equal(reading.usedWorld, false);
});

test("facing the camera, a shoulder press lean-back is seen only in 3D", () => {
  const press = getExerciseRule("shoulder_press") as ExerciseRule;
  // Facing the camera with the torso leaning 20° back, towards the far wall: in the picture it looks upright.
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.05 }));
  const world: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.05 }));
  const lean = (20 * Math.PI) / 180;
  const put = (index: number, x: number, y: number, depth = 0) => {
    points[index] = { x: 0.5 + x / ASPECT, y: 0.6 + y, visibility: 0.95 };
    world[index] = { x, y, z: depth, visibility: 0.95 };
  };
  for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
    const hip = side === "left" ? LANDMARK.leftHip : LANDMARK.rightHip;
    const shoulder = side === "left" ? LANDMARK.leftShoulder : LANDMARK.rightShoulder;
    const elbow = side === "left" ? LANDMARK.leftElbow : LANDMARK.rightElbow;
    const wrist = side === "left" ? LANDMARK.leftWrist : LANDMARK.rightWrist;
    put(hip, sign * 0.08, 0);
    put(shoulder, sign * 0.08, -0.27 * Math.cos(lean), 0.27 * Math.sin(lean));
    put(elbow, sign * 0.2, -0.27 * Math.cos(lean), 0.27 * Math.sin(lean));
    put(wrist, sign * 0.2, -0.27 * Math.cos(lean) - 0.12, 0.27 * Math.sin(lean));
  }
  const flat = readFrame(press, { t: 0, points, aspect: ASPECT }, null);
  const deep = readFrame(press, { t: 0, points, aspect: ASPECT, world }, null);
  assert.ok((flat.values.torso ?? 99) < 3, `the picture sees ${flat.values.torso?.toFixed(1)}°`);
  assert.ok(Math.abs((deep.values.torso ?? 0) - 20) < 1, `3D sees ${deep.values.torso?.toFixed(1)}°`);
});
