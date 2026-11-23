// Framing (BRIEF-2 3.1 and 3.2): which part of an authored frame a viewer actually sees, the protected box every
// `must` subject stays inside, and the check verify.mjs runs on the lab's `project()` output. Pure; all boxes are in
// normalised frame coordinates (x right, y down, 0..1 over the rendered frame).
import { COMPOSITIONS, pickComposition } from "../../../../src/components/brand/films/compositions.ts";

/** The 82% rule: the protected box is the always-visible part shrunk by 9% on each side. */
export const PROTECT_MARGIN = 0.09;

/** The part of a frame of aspect `frameAspect` that a cover fit shows on a viewport of aspect `viewAspect`. */
export function visibleRegion(frameAspect, viewAspect) {
  if (viewAspect < frameAspect) {
    const share = viewAspect / frameAspect;
    return { x0: (1 - share) / 2, y0: 0, x1: (1 + share) / 2, y1: 1 };
  }
  const share = frameAspect / viewAspect;
  return { x0: 0, y0: (1 - share) / 2, x1: 1, y1: (1 + share) / 2 };
}

export function intersect(a, b) {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

export function shrink(box, margin = PROTECT_MARGIN) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  return { x0: box.x0 + w * margin, y0: box.y0 + h * margin, x1: box.x1 - w * margin, y1: box.y1 - h * margin };
}

/** The band of each composition id. */
export function band(id) {
  const found = COMPOSITIONS.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown composition ${id}`);
  return found;
}

/**
 * The real viewport aspects at which a film's composition `comp` must hold its framing: the check edges of every band
 * it serves. Without `available`, a composition serves only its own band. With it, a composition also serves the
 * bands of compositions the film lacks (`pickComposition`'s nearest rule), so their edges are checked too.
 */
export function servedEdges(comp, available) {
  const edges = [];
  for (const entry of COMPOSITIONS) {
    const middle = Math.sqrt(entry.checkMin * entry.checkMax);
    const served = available && available.length ? pickComposition(middle * 1000, 1000, available) : entry.id;
    if (served === comp) edges.push(entry.checkMin, entry.checkMax);
  }
  return [...new Set(edges)].sort((a, b) => a - b);
}

/** The protected box of a composition: visible at every edge it serves, shrunk by the margin. */
export function protectedBox(comp, available) {
  const frame = band(comp);
  let box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  for (const edge of servedEdges(comp, available)) box = intersect(box, visibleRegion(frame.aspect, edge));
  return shrink(box);
}

/** A screen box from projected points (normalised device coordinates, x and y in -1..1, y up), or null if behind. */
export function boxFromNdc(points) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y, z] of points) {
    if (!(z > -1 && z < 1)) return null;
    const sx = (x + 1) / 2;
    const sy = (1 - y) / 2;
    x0 = Math.min(x0, sx);
    y0 = Math.min(y0, sy);
    x1 = Math.max(x1, sx);
    y1 = Math.max(y1, sy);
  }
  return { x0, y0, x1, y1 };
}

export function inside(box, area, tolerance = 1e-6) {
  return box.x0 >= area.x0 - tolerance && box.y0 >= area.y0 - tolerance && box.x1 <= area.x1 + tolerance && box.y1 <= area.y1 + tolerance;
}

export function overlaps(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * Framing failures of one frame: each `must` subject outside the protected box, behind the camera, or under a zone
 * (letterbox bars or a callout area from overlay-zones.ts, given as normalised boxes active at this time).
 * `subjects` are `{ id, must, box }` with `box` null when behind the camera.
 */
/**
 * @param {{ comp: string, available?: string[], subjects: { id: string, must: boolean, box: { x0: number, y0: number, x1: number, y1: number } | null }[], zones?: { id: string, box: { x0: number, y0: number, x1: number, y1: number } }[] }} input
 */
export function framingFailures({ comp, available, subjects, zones = [] }) {
  const area = protectedBox(comp, available);
  const failures = [];
  for (const subject of subjects) {
    if (!subject.must) continue;
    if (!subject.box) {
      failures.push({ id: subject.id, problem: "behind the camera" });
      continue;
    }
    if (!inside(subject.box, area)) failures.push({ id: subject.id, problem: "outside the protected box", box: subject.box, area });
    for (const zone of zones) if (overlaps(subject.box, zone.box)) failures.push({ id: subject.id, problem: `under ${zone.id}`, box: subject.box, zone: zone.box });
  }
  return failures;
}

/** The frames verify.mjs projects: every 6th frame, and each shot boundary ± 1 (inside the film). */
export function framingFrames(film, fps = 60) {
  const total = Math.max(1, Math.round(film.duration * fps - 1e-6));
  const frames = new Set();
  for (let index = 0; index < total; index += 6) frames.add(index);
  for (const shot of film.shots) {
    const cut = Math.round(shot.start * fps);
    for (const index of [cut - 1, cut, cut + 1]) if (index >= 0 && index < total) frames.add(index);
  }
  return [...frames].sort((a, b) => a - b);
}
