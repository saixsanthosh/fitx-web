// Bug 77 (the body map part): on a 390 px touch phone the Browse by muscle map's neck plates were 14 × 33 px, the traps
// 88 × 26, each shoulder 30 × 47, and the lats, lower back, abductors and adductors also under 44 px; the Front and
// Back toggles were 67 × 40. Small plates now carry an invisible hit area that never covers another muscle's plate;
// the toggles are 44 px tall. Re-check of release 3: at phone size nearly every plate is small, the 44 px rectangles
// overlapped, and the muscle drawn later took the whole overlap (the back adductors kept almost none of theirs, the
// front lats 4 %). Now two muscles' areas never overlap: each keeps the part nearer its own plate.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BODY_ART, BODY_VIEWBOX, type BodyView } from "@/components/anatomy/body-paths";
import { FIGURE_PX, HIT_MIN_PX, nearerTo, pathBox, pickerHitAreas, unitsPerPixel, type Box } from "@/components/anatomy/hit-areas";
import { BODY_REGIONS, type RegionKey } from "@/lib/training/anatomy";

const VIEWS: BodyView[] = ["front", "back"];
type Point = [number, number];
const union = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((box) => box.x)); const y = Math.min(...boxes.map((box) => box.y));
  return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
};
const within = (inner: Box, outer: Box, slack = 0.05) => inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;
const grownBy = (box: Box, min: number): Box => {
  const width = Math.max(box.width, min); const height = Math.max(box.height, min);
  return { x: box.x - (width - box.width) / 2, y: box.y - (height - box.height) / 2, width, height };
};

/** A path drawn with M, L, C and Z as a polygon, each curve as 12 straight pieces. */
function outline(d: string): Point[] {
  const tokens = d.match(/[MLCZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const points: Point[] = []; let command = ""; let x = 0; let y = 0;
  for (let index = 0; index < tokens.length;) {
    if (/^[MLCZ]$/.test(tokens[index])) { command = tokens[index]; index += 1; continue; }
    if (command === "M" || command === "L") { x = Number(tokens[index]); y = Number(tokens[index + 1]); points.push([x, y]); index += 2; continue; }
    if (command === "C") {
      const [x1, y1, x2, y2, x3, y3] = tokens.slice(index, index + 6).map(Number);
      for (let step = 1; step <= 12; step++) {
        const t = step / 12; const u = 1 - t;
        points.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
      }
      x = x3; y = y3; index += 6; continue;
    }
    index += 1;
  }
  return points;
}
function inside(points: readonly Point[], px: number, py: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]; const [xj, yj] = points[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
/** Whether two convex polygons share more than an edge (no separating axis among their edges' normals). */
function overlapping(a: readonly Point[], b: readonly Point[]): boolean {
  for (const shape of [a, b]) {
    for (let i = 0; i < shape.length; i++) {
      const [x1, y1] = shape[i]; const [x2, y2] = shape[(i + 1) % shape.length];
      const length = Math.hypot(y1 - y2, x2 - x1);
      if (length < 1e-9) continue;
      const axis: Point = [(y1 - y2) / length, (x2 - x1) / length];
      const project = (points: readonly Point[]) => points.map(([x, y]) => x * axis[0] + y * axis[1]);
      const pa = project(a); const pb = project(b);
      // The corners are rounded to 0.01 of a unit, so two areas that meet along a line may cross it by that much.
      if (Math.max(...pa) <= Math.min(...pb) + 0.02 || Math.max(...pb) <= Math.min(...pa) + 0.02) return false;
    }
  }
  return true;
}

describe("nearerTo", () => {
  test("keeps the part of a convex shape on its own side of the line halfway to a neighbour", () => {
    const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    assert.deepEqual(nearerTo(square, [2, 5], [8, 5]), [[0, 0], [5, 0], [5, 10], [0, 10]]);
    assert.deepEqual(nearerTo(square, [5, 5], [5, 40]), square, "a line that misses the shape changes nothing");
    assert.deepEqual(nearerTo(square, [5, 5], [5, 5]), square, "one centre: nothing to split");
    assert.deepEqual(nearerTo(square, [20, 5], [5, 5]), [], "all of it nearer the neighbour");
  });
});

describe("every small plate has a hit area of its own, at the size the map is drawn", () => {
  for (const figurePx of [FIGURE_PX.lg, 194, 126]) {
    test(`a figure ${figurePx} px wide`, () => {
      const scale = 1 / unitsPerPixel(figurePx);
      const min = HIT_MIN_PX / scale;
      for (const view of VIEWS) {
        const hits = pickerHitAreas(view, figurePx);
        for (const [key, paths] of Object.entries(BODY_ART[view].regions) as Array<[RegionKey, string[]]>) {
          const plates = paths.map(pathBox);
          const small = plates.filter((plate) => plate.width < min || plate.height < min);
          const areas = hits[key] ?? [];
          assert.equal(areas.length, small.length, `${view} ${key}: one area per small plate`);
          for (const plate of small) {
            const centre = [plate.x + plate.width / 2, plate.y + plate.height / 2] as const;
            assert.ok(areas.some((area) => within(area, grownBy(plate, min)) && inside(outline(area.d), centre[0], centre[1])), `${view} ${key}: the area around a ${(plate.width * scale).toFixed(0)} × ${(plate.height * scale).toFixed(0)} px plate`);
          }
          for (const area of areas) assert.ok(small.some((plate) => within(area, grownBy(plate, min))), `${view} ${key}: an area stays inside its plate's 44 px rectangle`);
        }
      }
    });
  }

  test("a large plate needs none", () => {
    assert.equal(pickerHitAreas("back", FIGURE_PX.lg).glutes, undefined);
  });
});

describe("two muscles' areas never overlap, and none covers another muscle's plate", () => {
  for (const figurePx of [FIGURE_PX.lg, 126]) {
    test(`a figure ${figurePx} px wide`, () => {
      for (const view of VIEWS) {
        const areas = Object.entries(pickerHitAreas(view, figurePx)).flatMap(([key, list]) => (list ?? []).map((area) => ({ key, area, points: outline(area.d) })));
        for (const [index, one] of areas.entries()) for (const other of areas.slice(index + 1)) {
          if (one.key !== other.key) assert.ok(!overlapping(one.points, other.points), `${view}: ${one.key} and ${other.key}`);
        }
        for (const { key, area } of areas) {
          for (const [otherKey, paths] of Object.entries(BODY_ART[view].regions)) for (const d of paths ?? []) {
            const box = pathBox(d);
            const reaches = area.x < box.x + box.width && box.x < area.x + area.width && area.y < box.y + box.height && box.y < area.y + area.height;
            if (otherKey !== key && reaches) assert.ok(area.clip?.includes(d), `${view} ${key}: ${otherKey}'s plate is cut out`);
            if (otherKey === key) assert.ok(!area.clip?.includes(d), `${view} ${key}: never its own plates`);
          }
        }
      }
    });
  }

  test("the neck's areas cut the traps' plates out", () => {
    const neck = pickerHitAreas("front", FIGURE_PX.lg).neck ?? [];
    const traps = BODY_ART.front.regions.traps ?? [];
    assert.ok(neck.length > 0 && neck.every((area) => area.clip && area.clip.startsWith(area.d)));
    assert.ok(neck.some((area) => traps.some((d) => area.clip!.includes(d))));
  });
});

describe("on a 390 px phone (a 210 px figure), what a tap selects", () => {
  // Every pixel of each view is hit-tested as the browser does: a plate first, then a hit area; the muscle drawn later
  // wins where two overlap. Before: the plain 44 px rectangles of release 3's first fix, which overlapped.
  const figurePx = FIGURE_PX.lg;
  const unit = unitsPerPixel(figurePx);
  const min = HIT_MIN_PX * unit;
  const selected = (view: BodyView, split: boolean) => {
    const plates = BODY_REGIONS.flatMap((key) => (BODY_ART[view].regions[key] ?? []).map((d) => ({ key, box: pathBox(d), points: outline(d) })));
    const before = plates.filter((plate) => plate.box.width < min || plate.box.height < min).map((plate) => ({ key: plate.key, box: grownBy(plate.box, min), points: null as Point[] | null }));
    const after = Object.entries(pickerHitAreas(view, figurePx)).flatMap(([key, list]) => (list ?? []).map((area) => ({ key: key as RegionKey, box: area as Box, points: outline(area.d) as Point[] | null })));
    const areas = split ? after : before;
    const extra = new Map<RegionKey, number>();
    let shared = 0;
    for (let row = 0; row < BODY_VIEWBOX.height / unit; row++) for (let column = 0; column < BODY_VIEWBOX.width / unit; column++) {
      const x = BODY_VIEWBOX.x + (column + 0.5) * unit; const y = BODY_VIEWBOX.y + (row + 0.5) * unit;
      const holds = (shape: { box: Box; points: Point[] | null }) => x >= shape.box.x && x <= shape.box.x + shape.box.width && y >= shape.box.y && y <= shape.box.y + shape.box.height && (!shape.points || inside(shape.points, x, y));
      if (plates.some(holds)) continue;
      const holders = [...new Set(areas.filter(holds).map((area) => area.key))];
      if (holders.length > 1) shared += 1;
      const top = BODY_REGIONS.filter((key) => holders.includes(key)).pop();
      if (top) extra.set(top, (extra.get(top) ?? 0) + 1);
    }
    return { extra, shared };
  };

  test("no point beside the plates belongs to two muscles any more", () => {
    for (const view of VIEWS) {
      assert.ok(selected(view, false).shared > 0, `${view}: the old rectangles overlapped`);
      assert.equal(selected(view, true).shared, 0, view);
    }
  });

  test("the smallest muscles keep far more of the area beside them", () => {
    const front = { before: selected("front", false).extra, after: selected("front", true).extra };
    const back = { before: selected("back", false).extra, after: selected("back", true).extra };
    const gain = (side: typeof front, key: RegionKey) => (side.after.get(key) ?? 0) / Math.max(1, side.before.get(key) ?? 0);
    for (const [label, side, key, factor] of [["front neck", front, "neck", 1.5], ["front lats", front, "lats", 2], ["front abductors", front, "abductors", 1.1], ["back adductors", back, "adductors", 4]] as const) {
      assert.ok(gain(side, key) >= factor, `${label}: ${side.before.get(key) ?? 0} → ${side.after.get(key) ?? 0} px beside its plates`);
    }
  });

  test("measured as the hunt measured (each muscle's button box), three are now just under 44 px one way", () => {
    // Their boxes no longer take in area that a neighbour's tap used to win: front traps 104 × 42, front lats 92 × 42,
    // back adductors 62 × 43.6. Every other muscle's button is still at least 44 × 44 px.
    const scale = 1 / unit;
    const under: string[] = [];
    for (const view of VIEWS) {
      const hits = pickerHitAreas(view, figurePx);
      for (const [key, paths] of Object.entries(BODY_ART[view].regions) as Array<[RegionKey, string[]]>) {
        const whole = union([...paths.map(pathBox), ...(hits[key] ?? [])]);
        const short = Math.min(whole.width, whole.height) * scale;
        assert.ok(short >= 41.5, `${view} ${key}: ${(whole.width * scale).toFixed(1)} × ${(whole.height * scale).toFixed(1)} px`);
        if (short < HIT_MIN_PX - 0.05) under.push(`${view} ${key}`);
      }
    }
    assert.deepEqual(under, ["front traps", "front lats", "back adductors"]);
  });
});

describe("the map and its page (JSX, read from the source)", () => {
  const map = readFileSync("src/components/anatomy/BodyMap.tsx", "utf8");
  const css = readFileSync("src/components/anatomy/BodyMap.module.css", "utf8");
  const page = readFileSync("src/app/(dashboard)/exercises/muscles/page.tsx", "utf8");

  test("the hit areas sit inside each muscle's button, under its plates, sized from the measured figure", () => {
    assert.match(map, /\{hitShapes\}\s+\{plates\}\s+<\/g>/);
    assert.match(map, /aria-hidden="true">\{hitShapes\}\{plates\}<\/g>/, "the copy in the other view too");
    assert.match(map, /pickerHitAreas\("front", figurePx\)/);
    assert.match(map, /new ResizeObserver/);
    assert.match(map, /\}, \[interactive, view\]\);/, "Front and Back swap the svg on phones: the new one is measured");
    assert.match(map, /<path className=\{styles\.hit\} data-hit-area="" d=\{hit\.d\} clipPath=\{hit\.clip \? `url\(#\$\{clipId\}\)` : undefined\} \/>/, "each area is drawn as its polygon");
    assert.match(map, /<clipPath id=\{clipId\}><path d=\{hit\.clip\} clipRule="evenodd" \/><\/clipPath>/);
    assert.match(css, /\.hit \{ fill: transparent; stroke: none; pointer-events: all; \}/);
  });

  test("the Front and Back toggles are 44 px tall", () => {
    const toggle = page.match(/aria-pressed=\{view === side\}[\s\S]*?className=\{`([^`]*)`\}/)?.[1] ?? "";
    assert.ok(toggle.split(/\s+/).includes("min-h-11"), toggle);
    assert.ok(!toggle.split(/\s+/).includes("min-h-10"));
  });

  test("the same rule elsewhere in Workouts: the builder's move buttons and the equipment chips", () => {
    assert.match(readFileSync("src/components/workouts/BuilderRow.tsx", "utf8"), /const MOVE_BUTTON = "relative grid h-8 w-9 [^"]*before:absolute before:-inset-x-1 before:-inset-y-1\.5/);
    assert.match(readFileSync("src/components/workouts/EquipmentPicker.tsx", "utf8"), /inline-flex min-h-11 items-center gap-1\.5 rounded-full/);
  });
});
