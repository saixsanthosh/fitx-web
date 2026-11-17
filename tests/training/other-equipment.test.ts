// "Other equipment" on the exercise page: similar movements for the same muscle with different equipment, one per
// equipment set, built only from the catalogue (spec 03 §7: alternative equipment, where suitable).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { toCatalogExercise, type CatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import { expandOwnedEquipment } from "@/lib/training/equipment";
import { OTHER_EQUIPMENT_LIMIT, equipmentSetLabel, equipmentSignature, otherEquipmentOptions, substitutesWithout } from "@/lib/training/other-equipment";
import { rankSubstitutes, type Substitute } from "@/lib/training/substitutions";
import { DEFAULT_GYM_EQUIPMENT } from "@/lib/training/taxonomy";

function exercise(id: string, over: Partial<CatalogExercise> = {}): CatalogExercise {
  return {
    id, name: id, primary_muscle: "chest", secondary_muscles: [], muscle_group: "chest", category: "strength", mechanic: "compound",
    required_equipment: [], locations: ["home", "gym"], difficulty: "intermediate", movement_pattern: "push", prescription_type: "reps",
    recommended_sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, default_duration_seconds: null, alternatives: [], source_ref: null, curated: true,
    ...over,
  };
}
const sub = (item: CatalogExercise, missing: string[] = []): Substitute => ({ exercise: item, score: 1, reasons: [], missing });

const target = exercise("bench", { required_equipment: ["barbell", "bench"] });

describe("other equipment", () => {
  test("one per other equipment set, the best-ranked first; what the member has comes first", () => {
    const options = otherEquipmentOptions(target, [
      sub(exercise("db-press", { required_equipment: ["dumbbell", "bench"] }), ["bench"]),
      sub(exercise("db-floor-press", { required_equipment: ["bench", "dumbbell"] })),
      sub(exercise("push-up")),
      sub(exercise("machine-press", { required_equipment: ["machine"] }), ["machine"]),
    ]);
    assert.deepEqual(options.map((option) => [option.exercise.id, option.signature, option.icon, option.label, option.missing]), [
      ["push-up", "none", "none", "No equipment", []],
      ["db-press", "bench+dumbbell", "dumbbell", "Dumbbells + Weight bench", ["bench"]],
      ["machine-press", "machine", "machine", "Weight machines", ["machine"]],
    ]);
  });

  test("only the same primary muscle, mechanic and category, with equipment that differs", () => {
    const options = otherEquipmentOptions(target, [
      sub(target),
      sub(exercise("same-kit", { required_equipment: ["bench", "barbell"] })),
      sub(exercise("more-kit", { required_equipment: ["barbell", "bench", "resistance_band"] })),
      sub(exercise("fly", { required_equipment: ["cable_machine"], mechanic: "isolation" })),
      sub(exercise("triceps-dip", { required_equipment: ["dip_station"], primary_muscle: "triceps" })),
      sub(exercise("stretch", { required_equipment: ["resistance_band"], category: "stretching" })),
      sub(exercise("plates-only", { required_equipment: ["barbell"] })),
    ]);
    assert.deepEqual(options.map((option) => option.exercise.id), ["plates-only"], "a subset of the kit is other equipment; the same kit or more is not");
  });

  test("a body-weight exercise can be done with any equipment instead", () => {
    const pushUp = exercise("push-up");
    const options = otherEquipmentOptions(pushUp, [sub(exercise("db-press", { required_equipment: ["dumbbell"] })), sub(exercise("knee-push-up"))]);
    assert.deepEqual(options.map((option) => option.exercise.id), ["db-press"]);
  });

  test("specialist kit (chains, sleds, strongman implements) comes after everything else", () => {
    const options = otherEquipmentOptions(target, [
      sub(exercise("chain-press", { required_equipment: ["bench", "specialty"] })),
      sub(exercise("machine-press", { required_equipment: ["machine"] }), ["machine"]),
      sub(exercise("push-up")),
    ]);
    assert.deepEqual(options.map((option) => option.exercise.id), ["push-up", "machine-press", "chain-press"]);
  });

  test("at most `limit`, and none when nothing fits", () => {
    const many = ["dumbbell", "kettlebell", "machine", "cable_machine", "smith_machine", "resistance_band"].map((key) => sub(exercise(key, { required_equipment: [key] })));
    assert.equal(otherEquipmentOptions(target, many).length, OTHER_EQUIPMENT_LIMIT);
    assert.equal(otherEquipmentOptions(target, many, 2).length, 2);
    assert.deepEqual(otherEquipmentOptions(target, []), []);
  });

  test("the rest of the substitutes leave out what other equipment shows", () => {
    const subs = [sub(exercise("a", { required_equipment: ["dumbbell"] })), sub(exercise("b", { required_equipment: ["barbell", "bench"] })), sub(exercise("c"))];
    const options = otherEquipmentOptions(target, subs);
    assert.deepEqual(substitutesWithout(subs, options).map((item) => item.exercise.id), ["b"]);
  });

  test("signatures and labels", () => {
    assert.equal(equipmentSignature(["bench", "dumbbell", "bench"]), "bench+dumbbell");
    assert.equal(equipmentSignature([]), "none");
    assert.equal(equipmentSetLabel([]), "No equipment");
    assert.equal(equipmentSetLabel(["cable_machine"]), "Cable machine");
  });
});

describe("other equipment in the real catalogue", () => {
  const catalog = (deriveCatalog() as Array<CatalogRow & { is_active: boolean }>).filter((row) => row.is_active).map(toCatalogExercise);
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const gym = expandOwnedEquipment(DEFAULT_GYM_EQUIPMENT);
  const optionsFor = (id: string, owned: ReadonlySet<string>) => {
    const item = byId.get(id);
    assert.ok(item, `${id} is active`);
    return otherEquipmentOptions(item, rankSubstitutes(item, catalog, { owned, level: "intermediate", doableOnly: false, limit: 60 }));
  };

  test("the barbell bench press offers dumbbells and no equipment; at home without a bench, the push-up comes first", () => {
    const atGym = optionsFor("bench_press", gym).map((option) => option.exercise.name);
    assert.ok(atGym.includes("Dumbbell Bench Press") && atGym.includes("Push-Up"), atGym.join(", "));
    const atHome = optionsFor("bench_press", expandOwnedEquipment(["dumbbell"]));
    assert.equal(atHome[0].exercise.name, "Push-Up");
    assert.deepEqual(atHome[0].missing, []);
  });

  test("every option, for every exercise, keeps the muscle and mechanic and changes the equipment", () => {
    let shown = 0;
    for (const item of catalog) {
      const options = optionsFor(item.id, gym);
      const signatures = new Set<string>();
      for (const option of options) {
        assert.equal(option.exercise.primary_muscle, item.primary_muscle, item.id);
        assert.equal(option.exercise.mechanic, item.mechanic, item.id);
        assert.equal(option.exercise.category, item.category, item.id);
        assert.notEqual(option.signature, equipmentSignature(item.required_equipment), item.id);
        assert.ok(!item.required_equipment.length || !item.required_equipment.every((key) => option.exercise.required_equipment.includes(key)), `${item.id}: ${option.exercise.id} needs everything ${item.id} needs`);
        assert.ok(!signatures.has(option.signature), `${item.id}: one option per equipment set`);
        signatures.add(option.signature);
        shown += 1;
      }
    }
    assert.ok(shown > 1000, `${shown} options checked`);
  });
});
