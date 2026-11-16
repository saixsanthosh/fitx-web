/**
 * Right-hand sculpt in several poses (worker-safe). OWNER: character-details agent.
 *
 * Authored in a canonical hand frame scaled to a 0.19 m reference hand (wrist → middle tip):
 *   u — along the fingers (bind: down and out along the arm),
 *   v — palm normal (palm side positive; bind: toward the thigh),
 *   w — thumb side (bind: +Z forward);  u × v = w.
 * Palm (roundbox core, thenar / hypothenar / distal pads, dorsal plane), a wrist sleeve that
 * slips inside the body's forearm, four fingers × three phalanges with knuckles, and a thumb
 * (metacarpal + two phalanges). Fingers are posed by MCP/PIP/DIP flexion and spread; the `grip`
 * and `glass` poses solve each joint's flexion by contact with the held cylinder, whose axis runs
 * along w through the grip point used by `motion/hands.ts` (GRIP_BAR / GRIP_GLASS).
 */

import type { Sdf, V3 } from "../../sdf/api";
import * as S from "../../sdf/index";
import type { HandPose } from "../types";

const DEG = Math.PI / 180;

/** Grip contract with motion/hands.ts: cylinder centre = wrist + u·along·L + v·palm·L, axis ‖ w. */
export const GRIP_POINTS: Record<"grip" | "glass", { along: number; palm: number; radius: number }> = {
  grip: { along: 0.47, palm: 0.15, radius: 0.015 },
  glass: { along: 0.42, palm: 0.3, radius: 0.037 },
};

interface Finger {
  name: string;
  /** MCP joint in reference units (u, v, w). */
  mcp: V3;
  /** Phalanx lengths (proximal, middle, distal). */
  len: [number, number, number];
  /** Radii at MCP, PIP, DIP, tip. */
  r: [number, number, number, number];
}

const FINGERS: Finger[] = [
  { name: "index", mcp: [0.0955, -0.0012, 0.0262], len: [0.043, 0.0255, 0.0215], r: [0.0094, 0.0085, 0.0075, 0.0066] },
  { name: "middle", mcp: [0.0995, -0.0012, 0.0082], len: [0.046, 0.0285, 0.0225], r: [0.0098, 0.0088, 0.0077, 0.0068] },
  { name: "ring", mcp: [0.0962, -0.0012, -0.0098], len: [0.043, 0.027, 0.0215], r: [0.0092, 0.0083, 0.0073, 0.0064] },
  { name: "little", mcp: [0.0875, -0.0008, -0.0262], len: [0.034, 0.02, 0.0185], r: [0.0083, 0.0074, 0.0066, 0.0058] },
];

export interface FingerChain {
  /** Joint centres MCP, PIP, DIP, tip (reference units). */
  joints: V3[];
  radii: number[];
  /** Palm-side normal of the distal phalanx (nail is on the opposite side). */
  pad: V3;
}

export interface PosedHand {
  sdf: Sdf;
  fingers: FingerChain[];
  thumb: FingerChain;
  /** Held cylinder (reference units) for the grip poses, else null. */
  held: { center: V3; radius: number } | null;
}

const rotTowards = (d: V3, n: V3, a: number): V3 => [d[0] * Math.cos(a) + n[0] * Math.sin(a), d[1] * Math.cos(a) + n[1] * Math.sin(a), d[2] * Math.cos(a) + n[2] * Math.sin(a)];

/** Flexes a finger chain from its MCP: `angles` per joint (radians), spread toward the thumb. */
function chain(f: Finger, angles: [number, number, number], spread: number): FingerChain {
  // Spread rotates the finger's rest direction (+u) toward +w in the u-w plane.
  let d: V3 = [Math.cos(spread), 0, Math.sin(spread)];
  const lateral: V3 = [-Math.sin(spread), 0, Math.cos(spread)];
  const joints: V3[] = [f.mcp];
  let p = f.mcp;
  let n: V3 = [0, 1, 0];
  for (let i = 0; i < 3; i += 1) {
    // Flexion turns the direction toward the palm (+v) about the lateral axis.
    const dn = S.cross(lateral, d);
    d = S.normalize(rotTowards(d, dn, angles[i]));
    n = S.cross(lateral, d);
    p = S.addScaled(p, d, f.len[i]);
    joints.push(p);
  }
  return { joints, radii: f.r.slice(), pad: S.normalize(n) };
}

/**
 * Solves flexion so each phalanx rests on a cylinder (axis ‖ w): bisection on the smallest angle
 * that brings the segment within `radius + finger radius` of the axis.
 */
function wrapChain(f: Finger, center: V3, radius: number, spread: number, maxAngles: [number, number, number], slack: number): FingerChain {
  const angles: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const reach = (a: number) => {
      const trial: [number, number, number] = [angles[0], angles[1], angles[2]];
      trial[i] = a;
      for (let j = i + 1; j < 3; j += 1) trial[j] = 0;
      const c = chain(f, trial, spread);
      const a0 = c.joints[i], a1 = c.joints[i + 1];
      // Distance in the u-v plane from the cylinder axis to the segment.
      const sx = a1[0] - a0[0], sy = a1[1] - a0[1];
      const t = Math.min(1, Math.max(0, ((center[0] - a0[0]) * sx + (center[1] - a0[1]) * sy) / (sx * sx + sy * sy)));
      const qx = a0[0] + sx * t - center[0], qy = a0[1] + sy * t - center[1];
      return Math.hypot(qx, qy) - (radius + f.r[i + 1] * 0.98 + slack);
    };
    let lo = 0, hi = maxAngles[i];
    if (reach(hi) > 0) {
      angles[i] = hi;
      continue;
    }
    for (let it = 0; it < 24; it += 1) {
      const mid = (lo + hi) / 2;
      if (reach(mid) > 0) lo = mid;
      else hi = mid;
    }
    angles[i] = lo;
  }
  return chain(f, angles, spread);
}

type ThumbDef = [V3, V3, V3, V3];

/** Thumb joints CMC, MCP, IP, tip per pose (reference units). */
const THUMB: Record<HandPose | "glass", ThumbDef> = {
  relaxed: [[0.022, 0.0075, 0.021], [0.0595, 0.0175, 0.0392], [0.0875, 0.0235, 0.0405], [0.1105, 0.0255, 0.0352]],
  fist: [[0.022, 0.0075, 0.021], [0.0585, 0.0235, 0.0395], [0.0825, 0.0425, 0.0305], [0.1005, 0.0482, 0.0115]],
  grip: [[0.022, 0.0075, 0.021], [0.0565, 0.0285, 0.0385], [0.0775, 0.0515, 0.0315], [0.0975, 0.0612, 0.0175]],
  glass: [[0.022, 0.0075, 0.021], [0.0545, 0.035, 0.044], [0.07, 0.0675, 0.0465], [0.0815, 0.0905, 0.042]],
  open: [[0.022, 0.0065, 0.022], [0.0505, 0.0075, 0.0545], [0.0705, 0.0055, 0.0775], [0.0885, 0.003, 0.0965]],
};
const THUMB_R = [0.0118, 0.0103, 0.0093, 0.0083];

/** Builds the posed hand SDF in reference units (0.19 m hand), `fem` slims it slightly. */
export function poseHand(pose: HandPose | "glass", fem: boolean): PosedHand {
  const slim = fem ? 0.93 : 1;
  let fingers: FingerChain[];
  let held: PosedHand["held"] = null;
  if (pose === "grip" || pose === "glass") {
    const g = GRIP_POINTS[pose];
    const center: V3 = [g.along * 0.19, g.palm * 0.19, 0];
    held = { center, radius: g.radius };
    const max: [number, number, number] = pose === "grip" ? [100 * DEG, 110 * DEG, 80 * DEG] : [70 * DEG, 70 * DEG, 60 * DEG];
    fingers = FINGERS.map((f, i) => wrapChain(f, center, g.radius, [0.04, 0, -0.04, -0.09][i], max, 0.0002));
  } else {
    const table: Record<string, Array<[number, number, number, number]>> = {
      // [MCP, PIP, DIP, spread] degrees, index → little.
      relaxed: [[10, 20, 11, 3], [14, 26, 13, 0], [18, 30, 15, -3], [23, 34, 17, -7]],
      fist: [[78, 96, 44, 1], [82, 98, 46, 0], [86, 100, 48, -1], [90, 100, 48, -3]],
      open: [[-4, 3, 2, 8], [-3, 2, 2, 1], [-3, 3, 2, -6], [-2, 4, 3, -13]],
    };
    fingers = FINGERS.map((f, i) => {
      const [a, b, c, s] = table[pose][i];
      return chain(f, [a * DEG, b * DEG, c * DEG], s * DEG);
    });
  }
  const scaleR = (c: FingerChain): FingerChain => ({ ...c, radii: c.radii.map((r) => r * slim) });
  fingers = fingers.map(scaleR);

  const tj = THUMB[pose];
  const thumbDir = S.normalize(S.sub(tj[3], tj[2]));
  const toward: V3 = [0, 0.6, -0.8];
  const thumbPadSide: V3 = S.normalize(S.sub(toward, S.scale(thumbDir, S.dot(toward, thumbDir))));
  const thumb: FingerChain = { joints: tj.slice(), radii: THUMB_R.map((r) => r * slim), pad: thumbPadSide };

  // ---- palm: core box, pads, dorsal plane, wrist sleeve.
  const sw = fem ? 0.95 : 1;
  // Palm runs to ~0.6 of the hand length so the fingers emerge at the webs, not at the knuckles.
  const palmCore = S.roundBox([0.0665, 0.0012, -0.0006], [0.0415, 0.0116 * slim, 0.0355 * sw], 0.0112);
  // Heel of the hand: narrower toward the wrist so the back of the hand tapers.
  const heel = S.ellipsoid([0.028, 0.0015, -0.0005], [0.026, 0.0128 * slim, 0.0305 * sw]);
  const thenar = S.ellipsoid([0.034, 0.0085, 0.0215 * sw], [0.0265, 0.0118 * slim, 0.0168], S.quatFromAxisAngle([0, 1, 0], 0.35));
  const hypothenar = S.ellipsoid([0.046, 0.0075, -0.0262 * sw], [0.032, 0.0098 * slim, 0.0118]);
  const distalPad = S.ellipsoid([0.0965, 0.0058, -0.0012], [0.0142, 0.0078 * slim, 0.0352 * sw]);
  const dorsum = S.ellipsoid([0.07, -0.0035, -0.001], [0.042, 0.0096 * slim, 0.0348 * sw]);
  const wrist = S.ellipsoid([-0.004, 0.0008, 0], [0.024, 0.0172 * slim, 0.0262 * sw]);
  const palm = S.smoothUnion(0.0085, palmCore, heel, thenar, hypothenar, distalPad, dorsum, wrist);

  const fingerSdfs = fingers.map((c) => {
    const segs: Sdf[] = [];
    for (let i = 0; i < 3; i += 1) segs.push(S.roundCone(c.joints[i], c.joints[i + 1], c.radii[i], c.radii[i + 1]));
    // Knuckle on the back of the MCP and slight joint swell at PIP.
    const back = S.scale(c.pad, -1);
    segs.push(S.sphere(S.addScaled(c.joints[0], back, c.radii[0] * 0.45), c.radii[0] * 0.78));
    segs.push(S.sphere(S.addScaled(c.joints[1], back, c.radii[1] * 0.2), c.radii[1] * 0.98));
    return S.smoothUnion(0.0032, ...segs);
  });
  // The thumb's metacarpal melts into the thenar pad; its phalanges only touch what they rest on.
  const thumbBase = S.roundCone(thumb.joints[0], thumb.joints[1], thumb.radii[0], thumb.radii[1]);
  const thumbTip = S.smoothUnion(0.004, S.roundCone(thumb.joints[1], thumb.joints[2], thumb.radii[1], thumb.radii[2]), S.roundCone(thumb.joints[2], thumb.joints[3], thumb.radii[2], thumb.radii[3]));
  // Fingers never blend into each other (hard union keeps the gaps); they blend into the palm.
  const palmThumb = S.smoothUnion(0.009, palm, thumbBase);
  const withFingers = S.smoothUnion(0.0085, palmThumb, S.union(...fingerSdfs));
  const hand = S.smoothUnion(0.0034, withFingers, thumbTip);
  return { sdf: hand, fingers, thumb, held };
}
