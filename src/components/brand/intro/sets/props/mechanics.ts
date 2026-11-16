/**
 * Small mechanical helpers for the props: toothed gear outlines and a belt/chain path solver that
 * wraps a closed loop around circles (chainring, cog, jockey wheels) with exact tangent runs.
 */

import * as THREE from "three";

/** Sprocket outline with `teeth` teeth for a chain of `pitch` (meters). Optional centre hole. */
export function gearShape(teeth: number, pitch: number, options: { hole?: number; boltHoles?: { count: number; radius: number; size: number } } = {}): THREE.Shape {
  const R = pitch / (2 * Math.sin(Math.PI / teeth));
  const tip = R + pitch * 0.32;
  const root = R - pitch * 0.33;
  const step = (Math.PI * 2) / teeth;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step;
    const pts: Array<[number, number]> = [
      [root, a - step * 0.5],
      [root * 1.005, a - step * 0.3],
      [tip, a - step * 0.12],
      [tip, a + step * 0.12],
      [root * 1.005, a + step * 0.3],
    ];
    pts.forEach(([r, ang], k) => {
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  if (options.hole) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, options.hole, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  if (options.boltHoles) {
    const { count, radius, size } = options.boltHoles;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + Math.PI / count;
      const hole = new THREE.Path();
      hole.absarc(Math.cos(a) * radius, Math.sin(a) * radius, size, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  return shape;
}

export function pitchRadius(teeth: number, pitch: number) {
  return pitch / (2 * Math.sin(Math.PI / teeth));
}

export interface BeltCircle {
  /** Centre in the 2D plane (u, v). */
  c: [number, number];
  r: number;
  /** Travel direction around this circle: true = clockwise (u right, v up). */
  cw: boolean;
}

export interface BeltPath {
  /** Closed polyline in (u, v), evenly usable via `sample`. */
  points: Array<[number, number]>;
  /** Cumulative arc length at each point (last = total length). */
  lengths: number[];
  length: number;
}

const perpCcw = (n: [number, number]): [number, number] => [-n[1], n[0]];

/** Solves the loop: tangent runs between consecutive circles plus wrap arcs. */
export function beltPath(circles: BeltCircle[], arcSegmentsPerRad = 20): BeltPath {
  const count = circles.length;
  // Departure/arrival normals per circle.
  const depart: Array<[number, number]> = new Array(count);
  const arrive: Array<[number, number]> = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const A = circles[i];
    const B = circles[(i + 1) % count];
    const sigmaA = A.cw ? -1 : 1;
    const same = A.cw === B.cw;
    const dx = B.c[0] - A.c[0];
    const dy = B.c[1] - A.c[1];
    const L = Math.hypot(dx, dy);
    const beta = Math.atan2(dy, dx);
    const k = (A.r - (same ? 1 : -1) * B.r) / L;
    const delta = Math.acos(Math.max(-1, Math.min(1, k)));
    let chosen: [number, number] = [1, 0];
    for (const alpha of [beta + delta, beta - delta]) {
      const n1: [number, number] = [Math.cos(alpha), Math.sin(alpha)];
      const n2: [number, number] = same ? n1 : [-n1[0], -n1[1]];
      const p1 = [A.c[0] + A.r * n1[0], A.c[1] + A.r * n1[1]];
      const p2 = [B.c[0] + B.r * n2[0], B.c[1] + B.r * n2[1]];
      const t = perpCcw(n1);
      if ((p2[0] - p1[0]) * t[0] * sigmaA + (p2[1] - p1[1]) * t[1] * sigmaA > 0) {
        chosen = n1;
        break;
      }
    }
    depart[i] = chosen;
    arrive[(i + 1) % count] = same ? chosen : [-chosen[0], -chosen[1]];
  }
  const points: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    const C = circles[i];
    const a0 = Math.atan2(arrive[i][1], arrive[i][0]);
    const a1 = Math.atan2(depart[i][1], depart[i][0]);
    let sweep = a1 - a0;
    if (C.cw) {
      while (sweep > 0) sweep -= Math.PI * 2;
    } else {
      while (sweep < 0) sweep += Math.PI * 2;
    }
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) * arcSegmentsPerRad));
    for (let s = 0; s <= steps; s += 1) {
      const a = a0 + (sweep * s) / steps;
      points.push([C.c[0] + Math.cos(a) * C.r, C.c[1] + Math.sin(a) * C.r]);
    }
  }
  points.push(points[0]);
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return { points, lengths, length: lengths[lengths.length - 1] };
}

/** Position and unit tangent at arc length `s` (wrapped) along a belt path. */
export function sampleBelt(path: BeltPath, s: number, out: { p: [number, number]; t: [number, number] }) {
  const L = path.length;
  let x = s % L;
  if (x < 0) x += L;
  let lo = 0;
  let hi = path.lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.lengths[mid] <= x) lo = mid;
    else hi = mid;
  }
  const seg = path.lengths[hi] - path.lengths[lo] || 1;
  const f = (x - path.lengths[lo]) / seg;
  const a = path.points[lo];
  const b = path.points[hi];
  out.p[0] = a[0] + (b[0] - a[0]) * f;
  out.p[1] = a[1] + (b[1] - a[1]) * f;
  const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  out.t[0] = (b[0] - a[0]) / tl;
  out.t[1] = (b[1] - a[1]) / tl;
  return out;
}
