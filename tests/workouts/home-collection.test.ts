import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { toCatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import { expandOwnedEquipment, isDoableWith } from "@/lib/training/equipment";
import { FOCUS_AREAS, exerciseMatchesFocus } from "@/lib/training/focus";
import { homeAreaCounts, homeCollection, isHomeExercise } from "@/lib/training/home-collection";
import { stapleRank } from "@/lib/training/staples";
import { levelRank } from "@/lib/training/taxonomy";

const catalog = (deriveCatalog() as (CatalogRow & { is_active: boolean })[]).filter((row) => row.is_active).map(toCatalogExercise);
const none = expandOwnedEquipment([]);
const dumbbells = expandOwnedEquipment(["dumbbell", "bench"]);

describe("Workouts' Home collection", () => {
  test("only home exercises the member can do with their home list, never olympic or strongman lifts", () => {
    const items = homeCollection(catalog, { owned: dumbbells, level: "intermediate" });
    assert.ok(items.length > 50, `${items.length} home exercises with dumbbells and a bench`);
    for (const exercise of items) {
      assert.ok(exercise.locations.includes("home"), exercise.id);
      assert.ok(isDoableWith(exercise.required_equipment, dumbbells), exercise.id);
      assert.ok(!["olympic", "strongman"].includes(exercise.category), exercise.id);
    }
    const bodyweight = homeCollection(catalog, { owned: none });
    assert.ok(bodyweight.length > 20 && bodyweight.every((exercise) => exercise.required_equipment.length === 0));
    assert.ok(bodyweight.length < items.length, "more equipment, more exercises");
  });

  test("an area lists only exercises that train it as their main muscle", () => {
    const chest = homeCollection(catalog, { owned: dumbbells, area: "chest" });
    assert.ok(chest.length > 0);
    assert.ok(chest.every((exercise) => exerciseMatchesFocus(exercise, "chest")));
    assert.ok(chest.some((exercise) => exercise.id === "push_up" || /push-?up/i.test(exercise.name)), "push-ups are home chest exercises");
  });

  test("staples first, then the member's level and below, then by name", () => {
    const items = homeCollection(catalog, { owned: dumbbells, level: "beginner" });
    const staples = items.findIndex((exercise) => stapleRank(exercise.id) === null);
    assert.ok(staples > 0, "staples lead");
    assert.ok(items.slice(0, staples).every((exercise) => stapleRank(exercise.id) !== null));
    const rest = items.slice(staples);
    const firstAbove = rest.findIndex((exercise) => levelRank(exercise.difficulty) > 0);
    if (firstAbove >= 0) assert.ok(rest.slice(firstAbove).every((exercise) => levelRank(exercise.difficulty) > 0), "harder exercises come after beginner ones");
  });

  test("area counts are what choosing each area would list", () => {
    const counts = homeAreaCounts(catalog, dumbbells);
    for (const area of FOCUS_AREAS) assert.equal(counts[area], homeCollection(catalog, { owned: dumbbells, area }).length, area);
    assert.equal(isHomeExercise({ locations: ["gym"], category: "strength", required_equipment: [] }, none), false);
  });
});
