/**
 * Turns camera landmarks into the drawn figure's points, so the live figure mirrors the member.
 * Pure maths (no browser APIs): the component smooths the framing and draws the result.
 */
import type { PosePoint, Side } from "@/lib/pose/landmarks";
import { isConfident, LANDMARK, landmarkIndex } from "@/lib/pose/landmarks";
import type { Box, FigurePoints, Part, Vec } from "./figure";

const PARTS: ReadonlyArray<readonly [Part, "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle" | "foot"]> = [
  ["shoulder", "shoulder"], ["elbow", "elbow"], ["wrist", "wrist"], ["hip", "hip"], ["knee", "knee"], ["ankle", "ankle"], ["toe", "foot"],
];

export interface LiveFrame {
  /** Points in square image units (x times the aspect), mirrored like the picture when asked. */
  points: FigurePoints;
  /** Figure segments and joints not seen clearly, to leave out of the drawing. */
  hidden: Set<string>;
  /** The box around what was seen, in the same units. */
  bounds: Box;
}

const SEGMENT_ENDS: ReadonlyArray<readonly [string, Part, Part]> = [
  ["upperArm", "shoulder", "elbow"], ["forearm", "elbow", "wrist"], ["thigh", "hip", "knee"], ["shin", "knee", "ankle"], ["foot", "ankle", "toe"],
];

/**
 * The live figure's frame from one set of landmarks. `near` is the side the camera sees best
 * (the rule's side), so a side-on member is drawn like the side-on demonstration.
 */
export function liveFrame(landmarks: readonly PosePoint[] | null, aspect: number, mirrored: boolean, side: Side | null, minVisibility = 0.5): LiveFrame | null {
  if (!landmarks || landmarks.length < 33) return null;
  const nearSide: Side = side ?? "left";
  const farSide: Side = nearSide === "left" ? "right" : "left";
  const seen = new Set<string>();
  const at = (index: number): Vec => {
    const p = landmarks[index];
    const x = (mirrored ? 1 - p.x : p.x) * aspect;
    return { x, y: p.y };
  };
  const limb = (s: Side, key: "near" | "far") => {
    const out = {} as Record<Part, Vec>;
    for (const [part, joint] of PARTS) {
      const index = landmarkIndex(joint, s);
      out[part] = at(index);
      if (isConfident(landmarks[index], minVisibility)) seen.add(`${key}:${part}`);
    }
    return out;
  };
  const near = limb(nearSide, "near");
  const far = limb(farSide, "far");
  const headIndex = [LANDMARK.nose, LANDMARK.leftEar, LANDMARK.rightEar].find((index) => isConfident(landmarks[index], minVisibility));
  const head = headIndex === undefined ? { x: (near.shoulder.x + far.shoulder.x) / 2, y: Math.min(near.shoulder.y, far.shoulder.y) - 0.08 } : at(headIndex);

  const hidden = new Set<string>();
  for (const key of ["near", "far"] as const) {
    for (const [segment, from, to] of SEGMENT_ENDS) if (!seen.has(`${key}:${from}`) || !seen.has(`${key}:${to}`)) hidden.add(`${key}-${segment}`);
  }
  for (const part of ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"] as const) if (!seen.has(`near:${part}`)) hidden.add(`joint-${part}`);
  if (!(seen.has("near:shoulder") && seen.has("far:shoulder") && seen.has("near:hip") && seen.has("far:hip"))) {
    // Without both shoulders and hips, fall back to the near side's own torso line.
    if (!(seen.has("near:shoulder") && seen.has("near:hip"))) hidden.add("torso");
  }
  if (headIndex === undefined) hidden.add("head");

  const visible = [...seen].map((key) => {
    const [which, part] = key.split(":") as ["near" | "far", Part];
    return (which === "near" ? near : far)[part];
  });
  if (headIndex !== undefined) visible.push(head);
  if (visible.length < 4) return null;
  const xs = visible.map((p) => p.x);
  const ys = visible.map((p) => p.y);
  const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  return { points: { head, near, far }, hidden, bounds };
}

/** Scale and offset that fit `bounds` into `stage` with padding, keeping proportions. */
export function fitTransform(bounds: Box, stage: Box, padding = 26): { scale: number; dx: number; dy: number } {
  const width = Math.max(bounds.width, 0.05);
  const height = Math.max(bounds.height, 0.05);
  const scale = Math.min((stage.width - padding * 2) / width, (stage.height - padding * 2) / height);
  const dx = stage.x + stage.width / 2 - (bounds.x + width / 2) * scale;
  const dy = stage.y + stage.height / 2 - (bounds.y + height / 2) * scale;
  return { scale, dx, dy };
}

export function applyTransform(points: FigurePoints, transform: { scale: number; dx: number; dy: number }): FigurePoints {
  const map = (p: Vec): Vec => ({ x: p.x * transform.scale + transform.dx, y: p.y * transform.scale + transform.dy });
  const side = (limb: Record<Part, Vec>) => Object.fromEntries(Object.entries(limb).map(([part, p]) => [part, map(p)])) as Record<Part, Vec>;
  return { head: map(points.head), near: side(points.near), far: side(points.far) };
}
