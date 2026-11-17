// MUSCLE_TO_GROUP covers every muscle value the catalogue stores and agrees with the body map (anatomy.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../../scripts/catalog/catalog.mjs";
import { groupForRegion, regionsForGroup, regionsForMuscle } from "@/lib/training/anatomy";
import { MUSCLE_GROUPS, MUSCLE_TO_GROUP, muscleGroupOf } from "@/lib/training/taxonomy";

type Row = { primary_muscle: string; secondary_muscles: string[] };
const rows = loadCatalog() as Row[];

test("the starter rows' older secondary words have a group, following the body map", () => {
  assert.deepEqual(
    ["front_deltoids", "rear_deltoids", "upper_chest", "hip_flexors", "ankles"].map((muscle) => [muscle, muscleGroupOf(muscle)]),
    [["front_deltoids", "shoulders"], ["rear_deltoids", "shoulders"], ["upper_chest", "chest"], ["hip_flexors", "quadriceps"], ["ankles", "calves"]],
  );
});

test("every muscle value in the catalogue, primary or secondary, has a group", () => {
  const values = new Set(rows.flatMap((row) => [row.primary_muscle, ...row.secondary_muscles]));
  assert.ok(values.has("front_deltoids") && values.has("ankles"), "the starter vocabulary is in the catalogue");
  for (const value of values) assert.ok(muscleGroupOf(value), `no group for "${value}"`);
});

test("each mapped value's body-map regions belong to its group", () => {
  for (const [muscle, group] of Object.entries(MUSCLE_TO_GROUP)) {
    assert.ok((MUSCLE_GROUPS as readonly string[]).includes(group), `${muscle} → ${group}`);
    const regions = regionsForMuscle(muscle);
    if (group === "full_body") { assert.deepEqual(regions, [], muscle); continue; }
    assert.ok(regions.length > 0, `${muscle} has a region`);
    for (const region of regions) assert.equal(groupForRegion(region), group, `${muscle} → ${region}`);
    assert.ok(regions.every((region) => regionsForGroup(group).includes(region)));
  }
});

test("muscleGroupOf ignores case and spaces and never reads Object.prototype", () => {
  assert.equal(muscleGroupOf(" Lower_Back "), "back");
  assert.equal(muscleGroupOf("CARDIO"), "full_body");
  for (const value of ["", "wings", "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) assert.equal(muscleGroupOf(value), null, value);
  assert.equal(muscleGroupOf(undefined as unknown as string), null);
});
