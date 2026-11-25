/**
 * Touch targets for the body map's picker (bug 77: on a 390 px phone the neck's plates were 14 × 33 px, the traps
 * 88 × 26, the shoulders 30 × 47 each, and the lats, lower back, abductors and adductors also under 44 px). Each
 * plate smaller than 44 × 44 px at the size the figure is drawn gets an invisible hit area: a rectangle centred on the
 * plate and at least 44 × 44 px, inside the region's own button, so tapping just beside a small muscle still selects
 * it. Each rectangle is clipped to leave out every other region's plates, so a tap on a neighbouring muscle always
 * selects that muscle: the extra area only ever covers the body's base and gaps. Pure data from body-paths.ts.
 */
import type { RegionKey } from "@/lib/training/anatomy";
import { BODY_ART, BODY_VIEWBOX, type BodyView } from "./body-paths";

/** The smallest touch target, in CSS pixels (FITX's rule, as everywhere else in the app). */
export const HIT_MIN_PX = 44;

export type Box = { x: number; y: number; width: number; height: number };

/** One invisible hit area: a rectangle in the figure's units, and the clip that leaves out other regions' plates. */
export type HitArea = Box & { clip: string | null };

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
 * The hit areas for one view with the figure drawn `figurePx` wide: per region, one rectangle for each of its plates
 * that is under 44 × 44 px there (none for a region whose plates are all large enough).
 */
export function pickerHitAreas(view: BodyView, figurePx: number): Partial<Record<RegionKey, HitArea[]>> {
  const min = HIT_MIN_PX * unitsPerPixel(figurePx);
  const cacheKey = `${view}:${rounded(min)}`;
  const known = cache.get(cacheKey);
  if (known) return known;
  const plates = platesOf(view);
  const areas: Partial<Record<RegionKey, HitArea[]>> = {};
  for (const plate of plates) {
    if (plate.box.width >= min && plate.box.height >= min) continue;
    const rect = grown(plate.box, min);
    const others = plates.filter((other) => other.key !== plate.key && overlaps(rect, other.box)).map((other) => other.d);
    const outline = `M${rounded(rect.x)} ${rounded(rect.y)}H${rounded(rect.x + rect.width)}V${rounded(rect.y + rect.height)}H${rounded(rect.x)}Z`;
    (areas[plate.key] ??= []).push({ x: rounded(rect.x), y: rounded(rect.y), width: rounded(rect.width), height: rounded(rect.height), clip: others.length ? `${outline} ${others.join(" ")}` : null });
  }
  cache.set(cacheKey, areas);
  return areas;
}

/** The figure's largest width for each BodyMap size (BodyMap.module.css), before the map has been measured. */
export const FIGURE_PX = { sm: 96, md: 150, lg: 210 } as const;
