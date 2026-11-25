// Bug 77 (the body map part): on a 390 px touch phone the Browse by muscle map's neck plates were 14 × 33 px, the
// traps 88 × 26, each shoulder 30 × 47, and the lats, lower back, abductors and adductors also under 44 px; the Front
// and Back toggles were 67 × 40. Small plates now carry an invisible 44 × 44 px hit area that never covers another
// muscle's plate; the toggles are 44 px tall.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BODY_ART, type BodyView } from "@/components/anatomy/body-paths";
import { FIGURE_PX, HIT_MIN_PX, pathBox, pickerHitAreas, unitsPerPixel, type Box } from "@/components/anatomy/hit-areas";
import type { RegionKey } from "@/lib/training/anatomy";

const VIEWS: BodyView[] = ["front", "back"];
const union = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((box) => box.x)); const y = Math.min(...boxes.map((box) => box.y));
  return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
};

describe("pathBox", () => {
  test("a straight-sided path's box, and a curve's true extent (not its control points)", () => {
    assert.deepEqual(pathBox("M0 0C0 0 10 0 10 0C10 0 10 5 10 5C10 5 0 5 0 5Z"), { x: 0, y: 0, width: 10, height: 5 });
    const arch = pathBox("M0 0C0 10 10 10 10 0Z");
    assert.equal(arch.height, 7.5, "a cubic arch peaks at 3/4 of its control points' height");
  });
});

describe("every muscle is at least 44 × 44 px to touch, at the size the map is drawn", () => {
  for (const figurePx of [FIGURE_PX.lg, 194, 126]) {
    test(`a figure ${figurePx} px wide`, () => {
      const scale = 1 / unitsPerPixel(figurePx);
      for (const view of VIEWS) {
        const hits = pickerHitAreas(view, figurePx);
        for (const [key, paths] of Object.entries(BODY_ART[view].regions) as Array<[RegionKey, string[]]>) {
          const plates = paths.map(pathBox);
          const areas = hits[key] ?? [];
          const whole = union([...plates, ...areas]);
          assert.ok(whole.width * scale >= HIT_MIN_PX - 0.05 && whole.height * scale >= HIT_MIN_PX - 0.05, `${view} ${key}: ${(whole.width * scale).toFixed(1)} × ${(whole.height * scale).toFixed(1)} px`);
          for (const plate of plates) {
            const small = plate.width * scale < HIT_MIN_PX || plate.height * scale < HIT_MIN_PX;
            const cover = areas.find((area) => area.x <= plate.x + 0.02 && area.y <= plate.y + 0.02 && area.x + area.width >= plate.x + plate.width - 0.02 && area.y + area.height >= plate.y + plate.height - 0.02);
            if (small) assert.ok(cover && cover.width * scale >= HIT_MIN_PX - 0.05 && cover.height * scale >= HIT_MIN_PX - 0.05, `${view} ${key}: a plate of ${(plate.width * scale).toFixed(0)} × ${(plate.height * scale).toFixed(0)} px has a 44 px hit area`);
          }
        }
      }
    });
  }

  test("the hunt's measurements at 390 px: neck, traps, shoulders, lats, lower back, abductors and adductors", () => {
    const scale = 1 / unitsPerPixel(FIGURE_PX.lg);
    const checked: Array<[BodyView, RegionKey]> = [["front", "neck"], ["front", "traps"], ["front", "shoulders"], ["front", "lats"], ["back", "lower_back"], ["back", "abductors"], ["back", "adductors"], ["back", "shoulders"]];
    for (const [view, key] of checked) {
      const areas = pickerHitAreas(view, FIGURE_PX.lg)[key] ?? [];
      assert.ok(areas.length > 0, `${view} ${key} has hit areas`);
      for (const area of areas) assert.ok(area.width * scale >= HIT_MIN_PX - 0.05 && area.height * scale >= HIT_MIN_PX - 0.05);
    }
  });

  test("a hit area leaves out every other muscle's plate it reaches, so a tap on a neighbour selects the neighbour", () => {
    const neck = pickerHitAreas("front", FIGURE_PX.lg).neck ?? [];
    const traps = BODY_ART.front.regions.traps ?? [];
    assert.ok(neck.every((area) => area.clip && area.clip.startsWith("M")), "each neck area is clipped");
    assert.ok(neck.some((area) => traps.some((d) => area.clip!.includes(d))), "the traps' plates are cut out of the neck's areas");
    for (const area of neck) for (const d of BODY_ART.front.regions.neck ?? []) assert.ok(!area.clip!.includes(d), "never its own plates");
  });

  test("a large plate needs none", () => {
    assert.equal(pickerHitAreas("back", FIGURE_PX.lg).glutes, undefined);
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
