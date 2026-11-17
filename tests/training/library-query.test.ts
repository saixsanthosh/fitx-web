import { describe, test } from "node:test";
import assert from "node:assert/strict";
// The cleaned catalogue exactly as migration 20261118130010 writes it (scripts/catalog).
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { exerciseRegions } from "@/lib/training/anatomy";
import { toCatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import {
  countCatalog,
  EMPTY_QUERY,
  expandUses,
  facetActive,
  MOVEMENT_PATTERNS,
  movementOf,
  normaliseMuscleValues,
  queryCatalog,
  relaxSuggestions,
  withoutFacet,
  type CatalogQuery,
} from "@/lib/training/catalog-search";
import { expandOwnedEquipment, isDoableWith } from "@/lib/training/equipment";
import { focusRole } from "@/lib/training/focus";
import { DEFAULT_GYM_EQUIPMENT, levelRank } from "@/lib/training/taxonomy";

const catalog = (deriveCatalog() as Array<CatalogRow & { is_active: boolean }>).filter((row) => row.is_active).map(toCatalogExercise);
const run = (query: Partial<CatalogQuery>, owned: readonly string[] | null = null, level: "beginner" | "intermediate" | "advanced" | null = null) =>
  queryCatalog(catalog, { ...EMPTY_QUERY, ...query }, { owned: owned ? expandOwnedEquipment(owned) : null, level });

describe("focus and equipment together (spec: Chest + Dumbbells)", () => {
  test("chest exercises the member can genuinely do with dumbbells come first; the rest say what they need", () => {
    const result = run({ focus: ["chest"] }, ["dumbbell"]);
    const owned = expandOwnedEquipment(["dumbbell"]);
    const firstUndoable = result.items.findIndex((item) => item.doable === false);
    assert.ok(firstUndoable > 5, "several doable chest exercises lead");
    const doableChest = result.items.slice(0, firstUndoable).filter((item) => item.focusTier === 0);
    assert.ok(doableChest.length > 3);
    for (const item of result.items.slice(0, firstUndoable)) assert.ok(isDoableWith(item.exercise.required_equipment, owned), `${item.exercise.name} is doable with dumbbells`);
    assert.ok(!result.items.slice(0, firstUndoable).some((item) => item.exercise.id === "dumbbell_bench_press"), "a dumbbell bench press needs a bench too");
    const bench = result.items.find((item) => item.exercise.id === "bench_press")!;
    assert.deepEqual([bench.doable, bench.missing], [false, ["barbell", "bench"]]);
    assert.equal(result.doableCount, result.items.filter((item) => item.doable).length);
  });

  test("main-muscle exercises before assisting ones; within each, what the member can do first", () => {
    const result = run({ focus: ["chest"] }, ["dumbbell", "bench"]);
    const tiers = result.items.map((item) => item.focusTier);
    assert.deepEqual(tiers, [...tiers].sort((a, b) => (a ?? 2) - (b ?? 2)));
    assert.ok(result.assistFrom !== null && result.items[result.assistFrom].focusTier === 1);
    for (const tier of [0, 1]) {
      const inTier = result.items.filter((item) => item.focusTier === tier);
      const stretches = inTier.map((item) => item.exercise.category === "stretching");
      assert.deepEqual(stretches, [...stretches].sort((a, b) => Number(a) - Number(b)), `tier ${tier}: stretches after training exercises`);
      for (const stretch of [false, true]) {
        const doable = inTier.filter((item) => (item.exercise.category === "stretching") === stretch).map((item) => item.doable);
        assert.deepEqual(doable, [...doable].sort((a, b) => Number(b) - Number(a)), `tier ${tier}: doable first`);
      }
    }
    assert.ok(result.items.every((item) => focusRole(item.exercise, "chest") !== null));
  });

  test("stretches come after training exercises unless stretching is asked for", () => {
    const back = run({ muscles: ["lats"] }, []);
    const firstStretch = back.items.findIndex((item) => item.exercise.category === "stretching");
    assert.ok(firstStretch > 0 && back.items.slice(firstStretch).every((item) => item.exercise.category === "stretching"));
    assert.equal(back.items[0].exercise.id, "pull_up", "a pull-up you need a bar for still leads a lat stretch");
    const asked = run({ muscles: ["lats"], categories: ["strength", "stretching"] }, []);
    assert.equal(asked.items[0].doable, true, "with stretching asked for, what the member can do leads again");
  });

  test("several areas: exercises that train more of them first; doable-only hides the rest", () => {
    const both = run({ focus: ["chest", "arms"], doableOnly: true }, DEFAULT_GYM_EQUIPMENT);
    assert.ok(both.items.every((item) => item.doable === true));
    assert.ok(both.items[0].focusScore >= 3, `${both.items[0].exercise.name} works chest and arms`);
    const none = run({ focus: ["arms"], doableOnly: true }, []);
    assert.ok(none.items.length > 0 && none.items.every((item) => item.exercise.required_equipment.length === 0));
  });

  test("Full body follows the catalogue's full-body rule, not the one-exercise group", () => {
    const result = run({ focus: ["full_body"] });
    assert.ok(result.items.length > 60);
    assert.ok(result.items.some((item) => item.exercise.category === "olympic"));
  });

  test("without an equipment list nothing is marked or hidden", () => {
    const result = run({ focus: ["back"], doableOnly: true });
    assert.equal(result.doableCount, null);
    assert.ok(result.items.every((item) => item.doable === null && item.missing.length === 0));
  });
});

describe("filters: OR within a kind, AND across kinds", () => {
  test("muscles: groups and body-map regions", () => {
    const lats = run({ muscles: ["lats"] });
    assert.ok(lats.items.length >= 30 && lats.items.every((item) => exerciseRegions(item.exercise.primary_muscle, item.exercise.secondary_muscles).primary.includes("lats")));
    const back = run({ muscles: ["back"] });
    assert.ok(back.items.length > lats.items.length && back.items.every((item) => item.exercise.muscle_group === "back"));
    assert.equal(countCatalog(catalog, { ...EMPTY_QUERY, muscles: ["chest", "triceps"] }, { owned: null }),
      countCatalog(catalog, { ...EMPTY_QUERY, muscles: ["chest"] }, { owned: null }) + countCatalog(catalog, { ...EMPTY_QUERY, muscles: ["triceps"] }, { owned: null }));
    assert.deepEqual(normaliseMuscleValues(["Lats", "upper-back", "abs", "back", "cardio", "elbows"]), ["lats", "middle_back", "abdominals", "back", "full_body"]);
  });

  test("equipment it uses: any of the items; body weight; the machines umbrella", () => {
    const bodyweight = run({ uses: ["none"] });
    assert.ok(bodyweight.items.length > 150 && bodyweight.items.every((item) => item.exercise.required_equipment.length === 0));
    const machines = run({ uses: ["machines"] });
    assert.ok(machines.items.every((item) => item.exercise.required_equipment.some((key) => ["machine", "smith_machine", "cardio_machine"].includes(key))));
    assert.ok(machines.items.some((item) => item.exercise.required_equipment.includes("smith_machine")));
    assert.deepEqual(expandUses(["machines", "barbell"]), ["machine", "smith_machine", "cardio_machine", "barbell"]);
    const armsBarbell = run({ focus: ["arms", "chest"], uses: ["barbell"] });
    assert.ok(armsBarbell.items.every((item) => item.exercise.required_equipment.includes("barbell")), "Arm + Chest + Barbell, as in the reference");
    assert.ok(armsBarbell.items.some((item) => item.exercise.muscle_group === "chest") && armsBarbell.items.some((item) => item.exercise.muscle_group === "biceps"));
  });

  test("difficulty, type, movement and mechanic", () => {
    const easy = run({ difficulties: ["beginner"], categories: ["strength", "stretching"] });
    assert.ok(easy.items.every((item) => item.exercise.difficulty === "beginner" && ["strength", "stretching"].includes(item.exercise.category)));
    const holds = run({ movements: ["hold"] });
    assert.ok(holds.items.length > 50 && holds.items.every((item) => movementOf(item.exercise.movement_pattern) === "hold"));
    assert.ok(run({ movements: ["pull"] }).items.some((item) => item.exercise.id === "romanian_deadlift"), "a hinge pulls");
    assert.ok(run({ movements: ["push"] }).items.some((item) => item.exercise.id === "hip_thrust"), "a hip thrust pushes, like its Free Exercise DB twin");
    assert.equal(run({ movements: ["push", "pull", "hold"] }).items.some((item) => item.exercise.category === "cardio" && movementOf(item.exercise.movement_pattern) === null), false, "no movement recorded, left out");
    const compound = run({ mechanics: ["compound"] });
    assert.ok(compound.items.every((item) => item.exercise.mechanic === "compound"));
    // Every movement pattern the catalogue uses is either mapped or deliberately has no movement.
    const unmapped = new Set(catalog.map((exercise) => exercise.movement_pattern).filter((pattern) => !movementOf(pattern)));
    assert.deepEqual([...unmapped].sort(), ["cardio", "plyometrics", "strength", "stretching", "strongman"]);
    assert.equal(new Set(Object.values(MOVEMENT_PATTERNS).flat()).size, Object.values(MOVEMENT_PATTERNS).flat().length, "a pattern belongs to one movement");
  });

  test("at home: home-friendly exercises, or ones the member's own list allows", () => {
    const empty = run({ environment: "home" }, []);
    assert.ok(empty.items.every((item) => item.exercise.locations.includes("home") || item.doable));
    const homeGym = run({ environment: "home" }, ["barbell", "squat_rack", "bench"]);
    assert.ok(homeGym.items.some((item) => item.exercise.id === "barbell_back_squat"), "a home gym with a rack counts");
    assert.ok(!empty.items.some((item) => item.exercise.id === "barbell_back_squat"));
  });

  test("saved ids, sorting by name and by difficulty", () => {
    assert.deepEqual(run({ ids: ["push_up", "pull_up", "nope"] , sort: "name" }).items.map((item) => item.exercise.name), ["Pull-Up", "Push-Up"]);
    const byLevel = run({ muscles: ["biceps"], sort: "difficulty" }).items.map((item) => levelRank(item.exercise.difficulty));
    assert.deepEqual(byLevel, [...byLevel].sort((a, b) => a - b));
  });

  test("best match without a search: what the member can do, then FITX staples", () => {
    const result = run({ muscles: ["quadriceps"] }, DEFAULT_GYM_EQUIPMENT, "beginner");
    assert.equal(result.items[0].exercise.id, "barbell_back_squat");
    const home = run({ muscles: ["quadriceps"] }, []);
    assert.ok(home.items[0].exercise.required_equipment.length === 0, "nothing needed comes first with no equipment");
  });
});

describe("empty results say what to change", () => {
  test("each active filter reports how many it hides, most first", () => {
    const query: CatalogQuery = { ...EMPTY_QUERY, q: "bench press", uses: ["kettlebell"], difficulties: ["advanced"] };
    assert.equal(countCatalog(catalog, query, { owned: null }), 0);
    const options = relaxSuggestions(catalog, query, { owned: null });
    assert.ok(options.length >= 2);
    assert.deepEqual(options.map((option) => option.count), [...options.map((option) => option.count)].sort((a, b) => b - a));
    const uses = options.find((option) => option.facet === "uses");
    assert.equal(uses?.count, countCatalog(catalog, withoutFacet(query, "uses"), { owned: null }));
    assert.ok(!options.some((option) => option.facet === "focus"), "inactive filters are not offered");
  });

  test("only-what-I-can-do and home are facets too", () => {
    const query: CatalogQuery = { ...EMPTY_QUERY, muscles: ["lats"], doableOnly: true, environment: "home" };
    assert.equal(facetActive(query, "doableOnly"), true);
    assert.equal(facetActive(query, "environment"), true);
    const options = relaxSuggestions(catalog, { ...query, uses: ["sled"] }, { owned: expandOwnedEquipment([]) });
    assert.ok(options.some((option) => option.facet === "uses"));
  });
});
