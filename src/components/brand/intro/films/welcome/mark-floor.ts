/**
 * The extruded mark floor of the welcome film (BRIEF-2 3.3): the FITX mark (`FITX_MARK_PATHS`) inlaid in the gym's
 * lifting platform, so that at the end of the crane the loaded bar, its three plates and the floor lines line up
 * into the mark, the lines ignite in the order the DOM mark forms (`FITX_MARK_ENTRY` and the formation delays in
 * globals.css), and `LogoReveal variant="film-end"` locks over them.
 *
 * Pure (no three.js, no DOM): the 3D mesh (`props.ts`), the shots, the lab and node tests share these numbers.
 *
 * Floor space is the gym set's (metres, +Y up). Seen from the top-down camera the mark stands upright with screen-up
 * along +X and screen-right along +Z, so the crane rises from the -X side looking +X and keeps its horizon:
 *   world X = (300 - y) * MARK_FLOOR_SCALE,  world Z = (x - 300) * MARK_FLOOR_SCALE   (x, y in viewBox units).
 * At 4.2 mm a unit the mark is 2.26 m (X) by 2.39 m (Z), inside the 2.6 m by 2.4 m platform, and its bar is the
 * real 2.2 m barbell (the bar piece runs 1.95 m; the real sleeve ends stand out past it as a real bar's do).
 */

import { COMPOSITIONS, type FilmComposition } from "../../../films/compositions";
import { FITX_MARK_BOUNDS, FITX_MARK_ENTRY, FITX_MARK_PATHS, FITX_MARK_SIZE, type FitxMarkPieceId } from "../../../logo/geometry";

/** Metres per viewBox unit. */
export const MARK_FLOOR_SCALE = 0.0042;
/** The viewBox centre (the mark is centred in its 600-unit square). */
const CENTRE = FITX_MARK_SIZE / 2;
/** Depth of the inlay above the platform surface (m): the lines are flush steel, proud by 2 mm. */
export const MARK_FLOOR_DEPTH = 0.002;

export type FloorPoint = { x: number; z: number };

/** A viewBox point on the floor (see the header for the axes). */
export function markToFloor(x: number, y: number): FloorPoint {
  return { x: (CENTRE - y) * MARK_FLOOR_SCALE, z: (x - CENTRE) * MARK_FLOOR_SCALE };
}

export type MarkCommand =
  | { kind: "M" | "L"; x: number; y: number }
  | { kind: "Q"; cx: number; cy: number; x: number; y: number }
  | { kind: "Z" };

/** Parses one of the mark's path strings (only M, L, Q and Z, absolute, as `polygonPath` writes them). */
export function parseMarkPath(d: string): MarkCommand[] {
  const tokens = d.match(/[MLQZ]|-?\d*\.?\d+/g) ?? [];
  const out: MarkCommand[] = [];
  let index = 0;
  const num = () => {
    const value = Number(tokens[index++]);
    if (!Number.isFinite(value)) throw new Error(`bad number in mark path near token ${index}`);
    return value;
  };
  while (index < tokens.length) {
    const kind = tokens[index++];
    if (kind === "M" || kind === "L") out.push({ kind, x: num(), y: num() });
    else if (kind === "Q") out.push({ kind, cx: num(), cy: num(), x: num(), y: num() });
    else if (kind === "Z") out.push({ kind });
    else throw new Error(`unsupported mark path command ${kind}`);
  }
  return out;
}

/** The outline of a piece in viewBox units, quadratic corners flattened into `steps` segments. */
export function markOutline(id: FitxMarkPieceId, steps = 4): [number, number][] {
  const piece = FITX_MARK_PATHS.find((path) => path.id === id);
  if (!piece) throw new Error(`no mark piece ${id}`);
  const points: [number, number][] = [];
  let last: [number, number] = [0, 0];
  for (const command of parseMarkPath(piece.d)) {
    if (command.kind === "M" || command.kind === "L") {
      last = [command.x, command.y];
      points.push(last);
    } else if (command.kind === "Q") {
      const [x0, y0] = last;
      for (let step = 1; step <= steps; step += 1) {
        const u = step / steps;
        const a = (1 - u) * (1 - u);
        const b = 2 * u * (1 - u);
        const c = u * u;
        points.push([a * x0 + b * command.cx + c * command.x, a * y0 + b * command.cy + c * command.y]);
      }
      last = [command.x, command.y];
    }
  }
  return points;
}

/** Signed area (shoelace) of an outline, in its own units squared. */
export function outlineArea(points: readonly (readonly [number, number])[]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

function centroid(points: readonly (readonly [number, number])[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const [px, py] of points) {
    x += px;
    y += py;
  }
  return [x / points.length, y / points.length];
}

/** The mark's footprint on the floor (m): `min`/`max` per axis. */
export const MARK_FLOOR_BOUNDS = (() => {
  const a = markToFloor(FITX_MARK_BOUNDS.x, FITX_MARK_BOUNDS.y);
  const b = markToFloor(FITX_MARK_BOUNDS.x + FITX_MARK_BOUNDS.width, FITX_MARK_BOUNDS.y + FITX_MARK_BOUNDS.height);
  return Object.freeze({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) });
})();

/** The bar piece's axis on the floor: the real barbell lies along it (world X constant, along Z). */
export const MARK_BAR_LINE = (() => {
  const outline = markOutline("bar");
  const ys = outline.map(([, y]) => y);
  const xs = outline.map(([x]) => x);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  return Object.freeze({
    x: markToFloor(0, mid).x,
    /** The piece's ends along the bar (its left end is cut at 41 degrees: `z0` is the long edge's tip). */
    z0: markToFloor(Math.min(...xs), 0).z,
    z1: markToFloor(Math.max(...xs), 0).z,
    /** The piece's width across the bar (m). */
    width: (Math.max(...ys) - Math.min(...ys)) * MARK_FLOOR_SCALE,
  });
})();

/** Where the mark's three plates sit along the bar (world Z of each piece's centroid) and their heights (m). */
export const MARK_PLATES = (["plate-1", "plate-2", "plate-3"] as const).map((id) => {
  const outline = markOutline(id);
  const [cx] = centroid(outline);
  const ys = outline.map(([, y]) => y);
  return Object.freeze({ id, z: markToFloor(cx, 0).z, height: (Math.max(...ys) - Math.min(...ys)) * MARK_FLOOR_SCALE });
});

// ------------------------------------------------------------------------------------------------- ignition

/**
 * The DOM formation's timing (globals.css `.fitx-mark__piece--<id>`: `--fitx-piece-at` and `--fitx-piece-ms`, at
 * tempo 1). The floor line of each piece ignites over the same window, so each DOM piece lands on a line that is
 * catching fire under it. `tests/brand/welcome-film.test.ts` reads globals.css and keeps the two in step.
 */
export const MARK_FORMATION_MS: Readonly<Record<FitxMarkPieceId, { at: number; ms: number }>> = Object.freeze({
  bar: { at: 0, ms: 440 },
  stem: { at: 150, ms: 400 },
  arm: { at: 280, ms: 360 },
  stroke: { at: 400, ms: 480 },
  branch: { at: 580, ms: 300 },
  "leg-inner": { at: 650, ms: 320 },
  "leg-outer": { at: 710, ms: 320 },
  "plate-1": { at: 880, ms: 420 },
  "plate-2": { at: 960, ms: 420 },
  "plate-3": { at: 1040, ms: 400 },
});

/** The order the pieces form and ignite in (FITX_MARK_PATHS order: the F, the X, then the plates). */
export const MARK_IGNITION_ORDER: readonly FitxMarkPieceId[] = FITX_MARK_PATHS.map(({ id }) => id);

/**
 * Each piece's ignition on the floor: it starts `at` s after `revealAt` and runs `duration` s. The flame front
 * travels the way the DOM piece travels as it forms (opposite to its `FITX_MARK_ENTRY` offset), in floor XZ.
 */
export type MarkIgnition = { id: FitxMarkPieceId; at: number; duration: number; direction: FloorPoint };

export const MARK_IGNITION: readonly MarkIgnition[] = MARK_IGNITION_ORDER.map((id) => {
  const entry = FITX_MARK_ENTRY[id];
  // Travel in viewBox units is -entry; turn it into a floor direction (the same axes as markToFloor, no offset).
  const tx = -entry.x;
  const ty = -entry.y;
  const length = Math.hypot(tx, ty) || 1;
  return Object.freeze({
    id,
    at: MARK_FORMATION_MS[id].at / 1000,
    duration: MARK_FORMATION_MS[id].ms / 1000,
    direction: { x: -ty / length, z: tx / length },
  });
});

/** Ignition of one piece at film time `time` (0 = dark, 1 = the whole line burning), smooth, a pure function of time. */
export function ignitionAt(id: FitxMarkPieceId, time: number, revealAt: number): number {
  const ignition = MARK_IGNITION.find((item) => item.id === id);
  if (!ignition) return 0;
  const u = (time - revealAt - ignition.at) / ignition.duration;
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  // The DOM easing is a fast-out curve (cubic-bezier(.22, 1, .36, 1)): the line catches quickly and finishes slowly.
  return 1 - (1 - u) ** 3;
}

/** When the last piece has finished igniting (s after `revealAt`). */
export const MARK_IGNITION_END = Math.max(...MARK_IGNITION.map((item) => item.at + item.duration));

// ------------------------------------------------------------------------------------------------- the reveal's box

/**
 * Where `LogoReveal` draws the mark in a viewport (px), from LogoReveal.module.css: `--reveal-size: clamp(120px,
 * 34vmin, 260px)`; the mark box is that wide but at most `min(70vw, 62vh)`; under it the lockup stacks a gap of
 * 0.1 R, the wordmark (0.26 R type, line height 1, letter clips padded 0.12 em), a gap of 0.1 R and the 2 px rule,
 * all centred on the stage. Returns the mark box's side and its centre.
 */
export function revealMarkBox(width: number, height: number) {
  const reveal = Math.min(260, Math.max(120, 0.34 * Math.min(width, height)));
  const side = Math.min(reveal, 0.7 * width, 0.62 * height);
  const lockup = side + 0.2 * reveal + 0.26 * reveal * 1.12 + 2;
  return { side, cx: width / 2, cy: height / 2 - lockup / 2 + side / 2, lockup, reveal };
}

/**
 * The viewport each composition's reveal is matched in: the composition's own shape at a common size (phone 390 x 844,
 * an iPad in portrait and in landscape, a 1440 laptop with its browser bars, a 1920 desktop window).
 */
export const REVEAL_REFERENCE: Readonly<Record<FilmComposition, { width: number; height: number }>> = Object.freeze({
  phone: { width: 390, height: 844 },
  "tablet-p": { width: 820, height: 1180 },
  "tablet-l": { width: 1180, height: 820 },
  laptop: { width: 1440, height: 810 },
  desktop: { width: 1920, height: 960 },
});

/**
 * The reveal's mark box in a composition's frame (the cut is drawn with `object-fit: cover`): its side as a share of
 * the frame's height, and its centre as shares of the frame's width and height (0.5 is the middle).
 */
export function revealMarkInFrame(comp: FilmComposition) {
  const band = COMPOSITIONS.find((item) => item.id === comp);
  if (!band) throw new Error(`no composition ${comp}`);
  const view = REVEAL_REFERENCE[comp];
  const box = revealMarkBox(view.width, view.height);
  const scale = Math.max(view.width / band.width, view.height / band.height);
  return {
    size: box.side / scale / band.height,
    cx: ((box.cx - view.width / 2) / scale + band.width / 2) / band.width,
    cy: ((box.cy - view.height / 2) / scale + band.height / 2) / band.height,
  };
}

// ------------------------------------------------------------------------------------------------- the top-down lens

/** 36 mm film gauge on the frame's long side, as `camera.ts` (three.js `filmGauge`). */
const FILM_GAUGE = 36;
/** The room the crane rises in (the gym set's shell, inner faces) and how high the lens may go under its roof. */
export const CRANE_LIMITS = Object.freeze({ maxHeight: 5.6, minFocal: 14, maxFocal: 60, room: { minX: -7.8, maxX: 7.8, minZ: -5.3, maxZ: 7.3 } });

/** The 600-unit box of the mark on the floor (m): the reveal's mark box covers exactly this. */
export const MARK_BOX_METRES = FITX_MARK_SIZE * MARK_FLOOR_SCALE;

/**
 * A straight-down framing of the mark floor for a composition: the lens at `height` above the inlay, with the focal
 * length that makes the mark's 600-unit box `ratio` times the reveal's mark box, and the frame centre offset so that
 * the box's centre lands where the reveal's does. Screen-up is +X. `floor` is the floor area the frame covers.
 */
export function topDownFraming(comp: FilmComposition, ratio: number, height: number) {
  const band = COMPOSITIONS.find((item) => item.id === comp);
  if (!band) throw new Error(`no composition ${comp}`);
  const reveal = revealMarkInFrame(comp);
  const filmHeight = FILM_GAUGE / Math.max(band.aspect, 1);
  // Frame height on the floor (m) when the box is `ratio` x the reveal's share of the frame height.
  const frameHeight = MARK_BOX_METRES / (reveal.size * ratio);
  const frameWidth = frameHeight * band.aspect;
  const focal = (height * filmHeight) / frameHeight;
  // The mark's centre (0, 0) sits at (cx, cy) of the frame: frame-up is +X, frame-right is +Z.
  const centreX = (reveal.cy - 0.5) * frameHeight;
  const centreZ = (0.5 - reveal.cx) * frameWidth;
  return {
    focal,
    centre: { x: centreX, z: centreZ },
    floor: { minX: centreX - frameHeight / 2, maxX: centreX + frameHeight / 2, minZ: centreZ - frameWidth / 2, maxZ: centreZ + frameWidth / 2 },
  };
}

/** True when a framing stays inside the room and the lens limits (no wall in frame, no fisheye). */
export function framingFits(framing: ReturnType<typeof topDownFraming>) {
  const { room, minFocal, maxFocal } = CRANE_LIMITS;
  const { floor, focal } = framing;
  return focal >= minFocal && focal <= maxFocal && floor.minX >= room.minX && floor.maxX <= room.maxX && floor.minZ >= room.minZ && floor.maxZ <= room.maxZ;
}

/**
 * The closest the floor mark can come to the reveal's size in a composition (the smallest ratio that still fits the
 * room at the highest lens), searched in 0.05 steps from 1. The ignite shot rises towards it while the frame clears
 * to the theme background, so the DOM mark locks over lines of about its own size.
 */
export function closestRevealRatio(comp: FilmComposition) {
  for (let ratio = 1; ratio <= 4; ratio = Math.round((ratio + 0.05) * 100) / 100) {
    if (framingFits(topDownFraming(comp, ratio, CRANE_LIMITS.maxHeight))) return ratio;
  }
  return 4;
}
