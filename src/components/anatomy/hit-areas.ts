/**
 * Touch targets for the body map's picker (bug 77: on a 390 px phone the neck's plates were 14 × 33 px, the traps
 * 88 × 26, the shoulders 30 × 47 each, and the lats, lower back, abductors and adductors also under 44 px). Each
 * plate smaller than 44 × 44 px at the size the figure is drawn gets an invisible hit area inside the region's own
 * button, so tapping just beside a small muscle still selects it: a rectangle centred on the plate and at least
 * 44 × 44 px, clipped to leave out every other region's plates, so a tap on a neighbouring muscle always selects that
 * muscle and the extra area only ever covers the body's base and gaps.
 *
 * At phone sizes nearly every plate is small, so these rectangles overlap, and the muscle drawn later used to take
 * the whole overlap (re-check of release 3: almost none of the back adductors' area selected them; the front lats kept
 * 4 % of theirs). Where two muscles' rectangles overlap, each now keeps the part nearer its own plate (the line halfway
 * between the two plates' centres), so the areas never overlap and a tap between two muscles selects the nearer one.
 * Each area is the convex polygon left. Pure data from body-paths.ts.
 */
import type { RegionKey } from "@/lib/training/anatomy";
import { BODY_ART, BODY_VIEWBOX, type BodyView } from "./body-paths";

/** The smallest touch target, in CSS pixels (FITX's rule, as everywhere else in the app). */
export const HIT_MIN_PX = 44;

export type Box = { x: number; y: number; width: number; height: number };

/**
 * One invisible hit area, in the figure's units: its outline (`d`, a convex polygon), the box around it, and the clip
 * that leaves out other regions' plates.
 */
export type HitArea = Box & { d: string; clip: string | null };

type Point = readonly [number, number];

const NUMBER = /[MCZmcz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** A cubic Bézier coordinate at t. */
function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** The t in (0, 1) where a cubic's coordinate turns (its derivative is 0). */
function turns(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/** The exact bounding box of a path drawn with absolute M, C and Z commands (the body map's artwork). */
export function pathBox(d: string): Box {
  const tokens = d.match(NUMBER) ?? [];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const add = (x: number, y: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  let command = "";
  let x = 0; let y = 0;
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (/^[MCZmcz]$/.test(token)) { command = token.toUpperCase(); index += 1; continue; }
    if (command === "M") {
      x = Number(tokens[index]); y = Number(tokens[index + 1]); add(x, y); index += 2;
      command = "M";
    } else if (command === "C") {
      const [x1, y1, x2, y2, x3, y3] = tokens.slice(index, index + 6).map(Number);
      add(x3, y3);
      for (const t of turns(x, x1, x2, x3)) add(cubic(x, x1, x2, x3, t), cubic(y, y1, y2, y3, t));
      for (const t of turns(y, y1, y2, y3)) add(cubic(x, x1, x2, x3, t), cubic(y, y1, y2, y3, t));
      x = x3; y = y3; index += 6;
    } else {
      index += 1;
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : { x: 0, y: 0, width: 0, height: 0 };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The plate grown to at least `min` each way, about its centre. */
function grown(box: Box, min: number): Box {
  const width = Math.max(box.width, min);
  const height = Math.max(box.height, min);
  return { x: box.x - (width - box.width) / 2, y: box.y - (height - box.height) / 2, width, height };
}

const rounded = (value: number) => Math.round(value * 100) / 100;

const centreOf = (box: Box): Point => [box.x + box.width / 2, box.y + box.height / 2];
const cornersOf = (box: Box): Point[] => [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]];

/**
 * The part of a convex polygon nearer `own` than `other`: the side of the line halfway between them (the perpendicular
 * bisector) that holds `own` (Sutherland–Hodgman with one edge). The result is convex too.
 */
export function nearerTo(polygon: readonly Point[], own: Point, other: Point): Point[] {
  const nx = other[0] - own[0];
  const ny = other[1] - own[1];
  if (Math.abs(nx) < 1e-9 && Math.abs(ny) < 1e-9) return [...polygon];
  const limit = (other[0] ** 2 + other[1] ** 2 - own[0] ** 2 - own[1] ** 2) / 2;
  const side = (point: Point) => nx * point[0] + ny * point[1] - limit;
  const kept: Point[] = [];
  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) kept.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      kept.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  });
  return kept;
}

function boxOf(points: readonly Point[]): Box {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const plateBoxes = new Map<BodyView, Array<{ key: RegionKey; d: string; box: Box }>>();
function platesOf(view: BodyView) {
  let plates = plateBoxes.get(view);
  if (!plates) {
    plates = Object.entries(BODY_ART[view].regions).flatMap(([key, paths]) => (paths ?? []).map((d) => ({ key: key as RegionKey, d, box: pathBox(d) })));
    plateBoxes.set(view, plates);
  }
  return plates;
}

/** Figure units per CSS pixel when one figure is drawn `figurePx` wide. */
export function unitsPerPixel(figurePx: number): number {
  return BODY_VIEWBOX.width / Math.max(1, figurePx);
}

const cache = new Map<string, Partial<Record<RegionKey, HitArea[]>>>();

/**
 * The hit areas for one view with the figure drawn `figurePx` wide: per region, one area for each of its plates that
 * is under 44 × 44 px there (none for a region whose plates are all large enough): the plate's 44 px rectangle,
 * less what is nearer another region's small plate whose rectangle reaches into it.
 */
export function pickerHitAreas(view: BodyView, figurePx: number): Partial<Record<RegionKey, HitArea[]>> {
  const min = HIT_MIN_PX * unitsPerPixel(figurePx);
  const cacheKey = `${view}:${rounded(min)}`;
  const known = cache.get(cacheKey);
  if (known) return known;
  const plates = platesOf(view);
  const small = plates.filter((plate) => plate.box.width < min || plate.box.height < min).map((plate) => ({ ...plate, rect: grown(plate.box, min), centre: centreOf(plate.box) }));
  const areas: Partial<Record<RegionKey, HitArea[]>> = {};
  for (const plate of small) {
    let polygon: Point[] = cornersOf(plate.rect);
    for (const other of small) if (other.key !== plate.key && overlaps(plate.rect, other.rect)) polygon = nearerTo(polygon, plate.centre, other.centre);
    const points = polygon.map(([x, y]): Point => [rounded(x), rounded(y)]);
    const box = points.length >= 3 ? boxOf(points) : null;
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const outline = `M${points.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
    const others = plates.filter((other) => other.key !== plate.key && overlaps(box, other.box)).map((other) => other.d);
    (areas[plate.key] ??= []).push({ x: box.x, y: box.y, width: rounded(box.width), height: rounded(box.height), d: outline, clip: others.length ? `${outline} ${others.join(" ")}` : null });
  }
  cache.set(cacheKey, areas);
  return areas;
}

/** The figure's largest width for each BodyMap size (BodyMap.module.css), before the map has been measured. */
export const FIGURE_PX = { sm: 96, md: 150, lg: 210 } as const;
