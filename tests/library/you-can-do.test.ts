// Bug 52 (workouts-12): for the same home equipment, Workouts said "Chest 13 … 13 you can do" and the Exercise library
// "83 · 23 you can do" (Back 14 v 31, Glutes 9 v 44…): Workouts counted the main muscle, the library any involvement.
// Both now count "you can do" the same way, main muscle only, and say so.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { toCatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import { EMPTY_QUERY, focusAreaCounts, queryCatalog, resultCountLine } from "@/lib/training/catalog-search";
import { expandOwnedEquipment } from "@/lib/training/equipment";
import { FOCUS_AREAS, FOCUS_COUNT_NOTE } from "@/lib/training/focus";
import { homeAreaCounts, homeCollection } from "@/lib/training/home-collection";

const catalog = (deriveCatalog() as Array<CatalogRow & { is_active: boolean }>).filter((row) => row.is_active).map(toCatalogExercise);
const HOME_LISTS: Record<string, string[]> = {
  "no equipment": [], dumbbells: ["dumbbell", "bench"], kettlebell: ["kettlebell"], bands: ["resistance_band"],
  "home gym": ["barbell", "bench", "squat_rack", "dumbbell"], "pull-up bar": ["pull_up_bar"],
};

describe("the same home list gives the same 'you can do' on both screens", () => {
  for (const [name, keys] of Object.entries(HOME_LISTS)) {
    test(name, () => {
      const owned = expandOwnedEquipment(keys);
      const workouts = homeAreaCounts(catalog, owned);
      const library = focusAreaCounts(catalog, { ...EMPTY_QUERY, environment: "home" }, { owned });
      for (const area of FOCUS_AREAS) {
        assert.equal(library[area].doable, workouts[area], `${area}: library ${library[area].doable}, Workouts ${workouts[area]}`);
        // And what each screen lists for the area agrees with its count.
        assert.equal(homeCollection(catalog, { owned, area }).length, workouts[area], area);
        const listed = queryCatalog(catalog, { ...EMPTY_QUERY, environment: "home", focus: [area], doableOnly: true }, { owned }).items.filter((item) => item.focusTier === 0).length;
        assert.equal(listed, workouts[area], `${area}: the library's main-muscle list with only what I can do`);
      }
    });
  }

  test("the hunt's case: no equipment at home, Chest", () => {
    const owned = expandOwnedEquipment([]);
    assert.equal(homeAreaCounts(catalog, owned).chest, focusAreaCounts(catalog, { ...EMPTY_QUERY, environment: "home" }, { owned }).chest.doable);
  });
});

describe("the results line names the tiers", () => {
  const item = (focusTier: 0 | 1 | null, doable: boolean | null) => ({ focusTier, doable });
  const items = [item(0, true), item(0, false), item(0, true), item(1, true), item(1, false)];

  test("with an area: main-muscle, of which you can do, then assisting", () => {
    assert.equal(resultCountLine(items, { focused: true, doableOnly: false, ownedKnown: true }), "3 main-muscle · 2 you can do · 2 assisting");
    assert.equal(resultCountLine(items.slice(0, 3), { focused: true, doableOnly: false, ownedKnown: true }), "3 main-muscle · 2 you can do");
  });

  test("only what I can do: the list is all doable, so the count needs no 'you can do'", () => {
    const doable = items.filter((entry) => entry.doable);
    assert.equal(resultCountLine(doable, { focused: true, doableOnly: true, ownedKnown: true }), "2 main-muscle · 1 assisting");
  });

  test("no equipment known: never a 0 'you can do'", () => {
    assert.equal(resultCountLine(items, { focused: true, doableOnly: false, ownedKnown: false }), "3 main-muscle · 2 assisting");
    assert.equal(resultCountLine(items, { focused: false, doableOnly: false, ownedKnown: false }), null);
    assert.equal(resultCountLine(items, { focused: false, doableOnly: false, ownedKnown: true }), "3 you can do");
  });
});

test("both screens say what the counts mean, in the same words", () => {
  assert.match(FOCUS_COUNT_NOTE, /main muscle/);
  const library = readFileSync("src/app/(dashboard)/exercises/page.tsx", "utf8");
  const home = readFileSync("src/components/workouts/HomeCollection.tsx", "utf8");
  assert.match(library, /\{focusDetails && <p className="m-0 text-xs text-fitx-text-secondary">\{FOCUS_COUNT_NOTE\}<\/p>\}/);
  assert.match(home, /<p className="m-0 text-xs text-fitx-text-secondary">\{FOCUS_COUNT_NOTE\}<\/p>/);
  assert.match(home, /\$\{counts\[key\]\.toLocaleString\(\)\} you can do/, "the Home tiles say 'you can do' as the library's do");
});
