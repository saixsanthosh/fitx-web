import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { exerciseBenefits, MAX_BENEFITS } from "@/lib/training/benefits";
import { toCatalogExercise, type CatalogRow } from "@/lib/training/catalog";

type Input = Parameters<typeof exerciseBenefits>[0];
const base: Input = { category: "strength", primary_muscle: "chest", secondary_muscles: ["triceps", "shoulders"], mechanic: "compound", required_equipment: [], prescription_type: "reps" };

test("benefits are stated only from the catalogue's own fields", () => {
  assert.deepEqual(exerciseBenefits(base), [
    "Builds strength in your chest",
    "Also works your triceps and shoulders",
    "Works several joints at once, so each set trains more muscle",
    "Needs no equipment, so you can do it anywhere",
  ]);
  const plank = exerciseBenefits({ ...base, primary_muscle: "abdominals", secondary_muscles: [], mechanic: "isolation", required_equipment: ["barbell"], prescription_type: "time" });
  assert.deepEqual(plank, ["Builds strength in your abdominals", "Targets one muscle directly, good for weak points", "Timed, so it is easy to progress by adding seconds"]);
  assert.equal(exerciseBenefits({ ...base, category: "cardio", primary_muscle: "cardio", secondary_muscles: [], mechanic: null, required_equipment: ["dumbbell"] })[0], "Raises your heart rate for conditioning");
  assert.match(exerciseBenefits({ ...base, required_equipment: ["dumbbell", "bench"], secondary_muscles: [] }).at(-1) ?? "", /^Can be done at home with dumbbells and weight bench$/);
  assert.equal(exerciseBenefits({ ...base, category: "stretching", primary_muscle: "hamstrings" })[0], "Stretches your hamstrings");
});

test("every active exercise gets between one and four lines, with no numbers or promises", () => {
  const rows = (deriveCatalog() as (CatalogRow & { is_active: boolean })[]).filter((row) => row.is_active).map(toCatalogExercise);
  for (const exercise of rows) {
    const lines = exerciseBenefits(exercise);
    assert.ok(lines.length >= 1 && lines.length <= MAX_BENEFITS, exercise.id);
    // The only number is how many more muscles an exercise also works ("and 2 more").
    for (const line of lines) assert.doesNotMatch(line.replace(/\b\d+ more\b/, ""), /\d|calorie|burn|guarantee|cure|%/i, `${exercise.id}: ${line}`);
  }
});
