import { describe, test } from "node:test";
import assert from "node:assert/strict";
// The cleaned catalogue exactly as migration 20261118130010 writes it, and the raw import rows (scripts/catalog).
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { loadSources } from "../../scripts/catalog/source.mjs";
import { programmeById } from "@/data/programmes";
import { BODY_REGIONS, exerciseRegions, isRegionKey, regionsForGroup, type RegionKey } from "@/lib/training/anatomy";
import { toCatalogExercise, type CatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import { expandOwnedEquipment, isDoableWith } from "@/lib/training/equipment";
import {
  FOCUS_AREAS, FOCUS_AREA_INFO, exerciseMatchesFocus, focusAreaFor, focusAreasForRegion, focusCounts, focusLabel, focusPhotoUrl,
  focusRegions, focusRole, focusScore, formatFocusParam, isFocusArea, isFullBodyExercise, listFocusAreas, normaliseFocusAreas,
  parseFocusParam, rankFocusExercises, type FocusArea,
} from "@/lib/training/focus";
import {
  FOCUS_TEMPLATES, MAX_FOCUS_SLOTS, focusSlotBudget, focusSlots, focusTemplate, generateDay, generateFocusDay, pickForSlot, slotCandidates,
  type GenerationContext, type SlotSpec,
} from "@/lib/training/generator";
import { PINNED_PHOTO_BASE } from "@/lib/training/media";
import { stapleRank } from "@/lib/training/staples";
import { DEFAULT_GYM_EQUIPMENT, LEVELS, MUSCLE_GROUPS, levelRank, type Level, type TrainingContext } from "@/lib/training/taxonomy";

type Row = CatalogRow & { is_active: boolean };
const rows = deriveCatalog() as Row[];
const catalog = rows.filter((row) => row.is_active).map(toCatalogExercise);
const byId = new Map(catalog.map((exercise) => [exercise.id, exercise]));
const get = (id: string) => {
  const exercise = byId.get(id);
  assert.ok(exercise, `${id} is an active catalogue exercise`);
  return exercise;
};

const PROFILES: Record<string, { owned: ReadonlySet<string>; context: TrainingContext }> = {
  gym: { owned: expandOwnedEquipment(DEFAULT_GYM_EQUIPMENT), context: "gym" },
  "home-none": { owned: expandOwnedEquipment([]), context: "home" },
  "home-db": { owned: expandOwnedEquipment(["dumbbell", "bench"]), context: "home" },
  "home-band": { owned: expandOwnedEquipment(["resistance_band", "pull_up_bar"]), context: "home" },
};
const ctxFor = (profile: keyof typeof PROFILES, level: Level, extra: Partial<GenerationContext> = {}): GenerationContext =>
  ({ catalog, owned: PROFILES[profile].owned, context: PROFILES[profile].context, level, seed: "2026-11-18:focus", ...extra });
const UPPER: ReadonlySet<RegionKey> = new Set(["traps", "shoulders", "chest", "biceps", "triceps", "lats", "middle_back"]);
const LOWER: ReadonlySet<RegionKey> = new Set(["glutes", "quadriceps", "hamstrings", "calves", "adductors", "abductors"]);

// ---------------------------------------------------------------- vocabulary

describe("focus vocabulary", () => {
  test("eight areas in display order, each fully described", () => {
    assert.deepEqual([...FOCUS_AREAS], ["full_body", "chest", "back", "shoulders", "arms", "abs", "legs", "glutes"]);
    for (const area of FOCUS_AREAS) {
      const info = FOCUS_AREA_INFO[area];
      assert.equal(info.key, area);
      assert.ok(info.label && info.label[0] === info.label[0].toUpperCase(), `${area} label`);
      assert.ok(info.description.length > 3 && info.description.length <= 60, `${area} description`);
      assert.ok(info.regions.length > 0 && info.regions.every(isRegionKey), `${area} regions`);
      assert.ok(info.assistRegions.every((region) => isRegionKey(region) && !info.regions.includes(region)), `${area} assist regions`);
      assert.ok(info.groups.length > 0 && info.groups.every((group) => (MUSCLE_GROUPS as readonly string[]).includes(group)), `${area} groups`);
      assert.ok(info.badgeView === "front" || info.badgeView === "back");
      // Every group's regions belong to the area (full body is a rule, not a set of groups).
      if (area !== "full_body") for (const group of info.groups) for (const region of regionsForGroup(group)) assert.ok(info.regions.includes(region), `${area}: ${group} → ${region}`);
    }
    assert.deepEqual([...FOCUS_AREA_INFO.full_body.regions], [...BODY_REGIONS]);
    assert.equal(isFocusArea("arms"), true);
    assert.equal(isFocusArea("arm"), false);
    assert.equal(isFocusArea(null), false);
  });

  test("the areas follow the decided muscle sets (C4)", () => {
    assert.deepEqual([...FOCUS_AREA_INFO.arms.regions], ["biceps", "triceps", "forearms"]);
    assert.deepEqual([...FOCUS_AREA_INFO.legs.regions], ["quadriceps", "hamstrings", "calves", "adductors", "abductors"]);
    assert.deepEqual([...FOCUS_AREA_INFO.abs.regions], ["abdominals"]);
    assert.deepEqual([...FOCUS_AREA_INFO.glutes.regions], ["glutes"]);
    assert.deepEqual([...FOCUS_AREA_INFO.back.regions], ["traps", "lats", "middle_back", "lower_back"]);
    assert.deepEqual([...FOCUS_AREA_INFO.shoulders.regions], ["shoulders"]);
    assert.deepEqual([...FOCUS_AREA_INFO.shoulders.assistRegions], ["traps"]);
    assert.deepEqual([...FOCUS_AREA_INFO.chest.regions], ["chest"]);
  });

  test("aliases, labels and keys in any case or spacing name an area; nothing else does", () => {
    const expected: Record<string, FocusArea> = {
      arm: "arms", arms: "arms", Arms: "arms",
      leg: "legs", legs: "legs", "lower body": "legs", "Lower-Body": "legs", thigh: "legs",
      belly: "abs", core: "abs", abs: "abs", ABS: "abs",
      butt: "glutes", glute: "glutes", glutes: "glutes", "butt & thigh": "glutes", "Butt and thigh": "glutes",
      back: "back", shoulders: "shoulders", shoulder: "shoulders",
      full_body: "full_body", "full body": "full_body", "Full-body": "full_body", chest: "chest",
    };
    for (const [word, area] of Object.entries(expected)) assert.equal(focusAreaFor(word), area, word);
    for (const word of ["", " ", "wings", "neck", "biceps", "constructor", "__proto__", "toString", "hasOwnProperty"]) assert.equal(focusAreaFor(word), null, word);
    assert.equal(focusAreaFor(undefined as unknown as string), null);
  });

  test("labels read as a phrase", () => {
    assert.equal(focusLabel("full_body"), "Full body");
    assert.equal(listFocusAreas([]), "");
    assert.equal(listFocusAreas(["abs"]), "Abs");
    assert.equal(listFocusAreas(["arms", "chest"]), "Chest and arms");
    assert.equal(listFocusAreas(["glutes", "full_body", "back"]), "Full body, back and glutes");
  });
});

describe("?focus= parameter", () => {
  test("reads comma lists, aliases and repeated values into display order without repeats", () => {
    assert.deepEqual(parseFocusParam("chest,arms"), ["chest", "arms"]);
    assert.deepEqual(parseFocusParam("arms,chest"), ["chest", "arms"]);
    assert.deepEqual(parseFocusParam(" Lower body , belly ,abs,core,,"), ["abs", "legs"]);
    assert.deepEqual(parseFocusParam(["glutes", "back,full_body"]), ["full_body", "back", "glutes"]);
    assert.deepEqual(parseFocusParam(new URLSearchParams("focus=lower+body,butt%20%26%20thigh").get("focus")), ["legs", "glutes"]);
    assert.deepEqual(parseFocusParam(new URLSearchParams("focus=chest&focus=arms").getAll("focus")), ["chest", "arms"]);
    for (const empty of [null, undefined, "", ",,", "wings,neck"]) assert.deepEqual(parseFocusParam(empty), [], String(empty));
    // A very long value is cut short, never thrown on.
    assert.deepEqual(parseFocusParam(`${"x,".repeat(5000)}chest`), []);
  });

  test("writes keys in display order and round-trips every selection", () => {
    assert.equal(formatFocusParam([]), "");
    assert.equal(formatFocusParam(["arms", "chest", "arms"]), "chest,arms");
    assert.equal(formatFocusParam(["full_body"]), "full_body");
    assert.equal(formatFocusParam(["bogus", "abs"]), "abs");
    for (let mask = 0; mask < 1 << FOCUS_AREAS.length; mask++) {
      const areas = FOCUS_AREAS.filter((_, index) => mask & (1 << index));
      assert.deepEqual(parseFocusParam(formatFocusParam(areas)), areas);
      assert.deepEqual(normaliseFocusAreas([...areas].reverse()), areas);
    }
  });
});

// ---------------------------------------------------------------- exercises

describe("which exercises train an area", () => {
  test("primary and secondary roles come from the catalogue's muscle labels", () => {
    assert.equal(focusRole(get("bench_press"), "chest"), "primary");
    assert.equal(focusRole(get("bench_press"), "arms"), "secondary", "triceps is a secondary muscle");
    assert.equal(focusRole(get("bench_press"), "shoulders"), "secondary", "front_deltoids reads as shoulders");
    assert.equal(focusRole(get("bench_press"), "legs"), null);
    assert.equal(focusRole(get("hip_thrust"), "glutes"), "primary");
    assert.equal(focusRole(get("hip_thrust"), "legs"), "secondary", "hamstrings");
    assert.equal(focusRole(get("barbell_back_squat"), "legs"), "primary");
    assert.equal(focusRole(get("barbell_back_squat"), "glutes"), "secondary", "glutes stay their own area");
    assert.equal(focusRole(get("free-exercise-db-Barbell_Shrug"), "back"), "primary");
    assert.equal(focusRole(get("free-exercise-db-Barbell_Shrug"), "shoulders"), "secondary", "traps assist the shoulders");
    assert.equal(focusRole(get("push_up"), "abs"), "secondary", "the starters' generic core reads as the abs");
    assert.equal(focusRole(get("dead_bug"), "abs"), "primary");
    assert.equal(exerciseMatchesFocus(get("barbell_back_squat"), "glutes"), false);
    assert.equal(exerciseMatchesFocus(get("barbell_back_squat"), "glutes", { includeSecondary: true }), true);
  });

  test("full body: the catalogue's full_body group, olympic and strongman lifts, and compound lifts reaching both halves", () => {
    for (const id of ["jumping_jack", "free-exercise-db-Clean_and_Press", "free-exercise-db-Barbell_Deadlift", "free-exercise-db-Kettlebell_Thruster", "free-exercise-db-Farmers_Walk"]) {
      assert.equal(isFullBodyExercise(get(id)), true, id);
      assert.equal(focusRole(get(id), "full_body"), "primary", id);
    }
    // One half only, an isolation hold, grip-only upper body, or the vague starter "back" label.
    for (const id of ["push_up", "barbell_back_squat", "plank", "free-exercise-db-Cable_Deadlifts", "romanian_deadlift", "lateral_raise"]) {
      assert.equal(isFullBodyExercise(get(id)), false, id);
    }
    for (const exercise of catalog) {
      if (exercise.category === "olympic" || exercise.category === "strongman") assert.equal(isFullBodyExercise(exercise), true, exercise.id);
      if (exercise.category === "stretching") assert.equal(isFullBodyExercise(exercise), false, `${exercise.id}: a stretch is never a full-body lift`);
      if (isFullBodyExercise(exercise) && exercise.category !== "olympic" && exercise.category !== "strongman" && exercise.muscle_group !== "full_body") {
        assert.equal(exercise.mechanic, "compound", exercise.id);
        const { primary, secondary } = exerciseRegions(exercise.primary_muscle, exercise.secondary_muscles);
        const regions = [...primary, ...secondary];
        assert.ok(regions.some((region) => UPPER.has(region)) && regions.some((region) => LOWER.has(region)), exercise.id);
      }
    }
  });

  test("every area resolves to at least 10 active exercises, and their muscles back the area", () => {
    const counts = focusCounts(catalog);
    for (const area of FOCUS_AREAS) {
      assert.ok(counts[area].total >= 10, `${area}: ${counts[area].total}`);
      assert.equal(counts[area].doable, null, "no equipment list given");
    }
    assert.ok(counts.full_body.total >= catalog.filter((exercise) => exercise.category === "olympic" || exercise.category === "strongman").length + 1);
    for (const exercise of catalog.filter((item) => exerciseMatchesFocus(item, "arms"))) assert.ok(["biceps", "triceps", "forearms"].includes(exercise.muscle_group), exercise.id);
    for (const exercise of catalog.filter((item) => exerciseMatchesFocus(item, "abs"))) assert.equal(exercise.muscle_group, "core", exercise.id);
    for (const exercise of catalog.filter((item) => exerciseMatchesFocus(item, "legs"))) assert.notEqual(exercise.muscle_group, "glutes", exercise.id);
  });

  test("counts with an equipment list say how many are doable", () => {
    const none = focusCounts(catalog, expandOwnedEquipment([]));
    const gym = focusCounts(catalog, PROFILES.gym.owned);
    for (const area of FOCUS_AREAS) {
      assert.ok(none[area].doable !== null && none[area].doable <= none[area].total);
      assert.ok(gym[area].doable !== null && gym[area].doable >= (none[area].doable ?? 0));
    }
    assert.ok((none.abs.doable ?? 0) >= 20, "plenty of body-weight core work");
    assert.equal(none.arms.doable, catalog.filter((exercise) => exerciseMatchesFocus(exercise, "arms") && exercise.required_equipment.length === 0).length);
  });

  test("focusScore: 2 per area trained as the primary muscle, 1 per area assisted", () => {
    assert.equal(focusScore(get("bench_press"), "chest"), 2);
    assert.equal(focusScore(get("bench_press"), ["chest", "arms"]), 3);
    assert.equal(focusScore(get("bench_press"), ["chest", "arms", "arms"]), 3, "repeats count once");
    assert.equal(focusScore(get("bench_press"), ["legs", "glutes"]), 0);
    assert.equal(focusScore(get("free-exercise-db-Clean_and_Press"), "full_body"), 2);
    assert.equal(focusScore(get("barbell_back_squat"), ["legs", "glutes", "abs"]), 4);
  });

  test("ranking: doable first, then exercises that train the areas directly, then staples; deterministic", () => {
    const dumbbells = expandOwnedEquipment(["dumbbell"]);
    // The spec's example: Chest + Dumbbells gives chest exercises that dumbbells really allow.
    const chest = rankFocusExercises(catalog, ["chest"], { owned: dumbbells, doableOnly: true });
    assert.ok(chest.length >= 3);
    for (const { exercise, doable } of chest) {
      assert.ok(doable && isDoableWith(exercise.required_equipment, dumbbells), exercise.id);
      assert.ok(focusScore(exercise, "chest") > 0, exercise.id);
      assert.notEqual(exercise.category, "stretching");
    }
    assert.equal(focusRole(chest[0].exercise, "chest"), "primary");
    const firstSecondary = chest.findIndex((item) => focusRole(item.exercise, "chest") !== "primary");
    if (firstSecondary >= 0) assert.ok(chest.slice(firstSecondary).every((item) => focusRole(item.exercise, "chest") !== "primary"), "direct chest work first");

    const arms = rankFocusExercises(catalog, ["arms"], { owned: PROFILES.gym.owned, level: "beginner", limit: 10 });
    assert.equal(arms.length, 10);
    for (const { exercise } of arms) assert.equal(focusRole(exercise, "arms"), "primary", exercise.id);
    assert.equal(stapleRank(arms[0].exercise.id), 0, "a most standard arm lift leads");

    const mixed = rankFocusExercises(catalog, ["arms", "chest"], { owned: PROFILES.gym.owned });
    assert.ok(mixed.findIndex((item) => item.exercise.id === "bench_press") < mixed.findIndex((item) => item.exercise.id === "cable_fly"), "chest and triceps together first");
    const notDoable = rankFocusExercises(catalog, ["back"], { owned: expandOwnedEquipment([]) });
    const lastDoable = notDoable.map((item) => item.doable).lastIndexOf(true);
    assert.ok(notDoable.slice(0, lastDoable + 1).every((item) => item.doable), "doable ones come first");
    assert.deepEqual(rankFocusExercises(catalog, ["glutes", "legs"]).map((item) => item.exercise.id), rankFocusExercises([...catalog].reverse(), ["legs", "glutes"]).map((item) => item.exercise.id));
    assert.deepEqual(rankFocusExercises(catalog, []), []);
    assert.ok(rankFocusExercises(catalog, ["full_body"], { limit: 20 }).every((item) => isFullBodyExercise(item.exercise)));
  });

  test("regions for a selection and areas for a region", () => {
    assert.deepEqual(focusRegions(["shoulders"]), { primary: ["shoulders"], secondary: ["traps"] });
    assert.deepEqual(focusRegions(["back", "shoulders"]), { primary: ["traps", "shoulders", "lats", "middle_back", "lower_back"], secondary: [] });
    assert.deepEqual(focusRegions([]), { primary: [], secondary: [] });
    assert.deepEqual(focusAreasForRegion("biceps"), ["arms"]);
    assert.deepEqual(focusAreasForRegion("traps"), ["back"]);
    assert.deepEqual(focusAreasForRegion("neck"), []);
  });
});

describe("tile photos", () => {
  const imported = new Set((loadSources().imported as unknown as Array<{ id: string }>).map((row) => row.id));
  test("each area shows a public-domain Free Exercise DB photo of an active exercise that trains it", () => {
    for (const area of FOCUS_AREAS) {
      const { photo } = FOCUS_AREA_INFO[area];
      const exercise = get(photo.exerciseId);
      assert.equal(exercise.source_ref, photo.sourceRef, `${area}: the photo is the exercise's own`);
      assert.ok(imported.has(`free-exercise-db-${photo.sourceRef}`), `${area}: ${photo.sourceRef} is in the pinned Free Exercise DB import`);
      assert.ok(photo.frame === 0 || photo.frame === 1);
      assert.match(photo.position, /^\d{1,3}% \d{1,3}%$/);
      assert.equal(focusPhotoUrl(area), `${PINNED_PHOTO_BASE}${photo.sourceRef}/${photo.frame}.jpg`);
      assert.equal(focusRole(exercise, area), "primary", `${area}: ${exercise.name} trains it`);
    }
    assert.equal(new Set(FOCUS_AREAS.map((area) => FOCUS_AREA_INFO[area].photo.sourceRef)).size, FOCUS_AREAS.length, "one photo per area");
  });
});

// ---------------------------------------------------------------- focus workouts

describe("focusSlots and generateFocusDay", () => {
  test("every preferred id in the templates is an active catalogue exercise", () => {
    for (const [area, slots] of Object.entries(FOCUS_TEMPLATES)) {
      assert.ok(slots.length >= 6, `${area} has enough slots for an advanced session`);
      for (const slot of slots) for (const id of slot.preferred ?? []) assert.ok(byId.has(id), `${area}: ${id}`);
    }
  });

  test("the length follows the level and the number of areas", () => {
    assert.deepEqual(LEVELS.map((level) => focusSlotBudget(level, 1)), [4, 5, 6]);
    assert.deepEqual(LEVELS.map((level) => focusSlotBudget(level, 2)), [5, 6, 7]);
    assert.deepEqual(LEVELS.map((level) => focusSlotBudget(level, 3)), [6, 7, 8]);
    assert.equal(focusSlotBudget("beginner", 8), MAX_FOCUS_SLOTS);
    assert.equal(focusSlotBudget("advanced", 0), 0);
  });

  test("without a catalogue: the areas take turns, main slots required, the rest optional", () => {
    const owned = PROFILES.gym.owned;
    assert.deepEqual(focusSlots([], "gym", owned), []);
    const one = focusSlots(["chest"], "gym", owned, { level: "intermediate" });
    assert.deepEqual(one.map((slot) => slot.label), FOCUS_TEMPLATES.chest.slice(0, 5).map((slot) => slot.label));
    assert.deepEqual(one.map((slot) => Boolean(slot.optional)), [false, false, false, true, true]);
    assert.ok(one.every((slot) => slot.focus === "chest"));
    const two = focusSlots(["arms", "chest"], "gym", owned, { level: "beginner" });
    assert.deepEqual(two.map((slot) => slot.focus), ["chest", "arms", "chest", "arms", "chest"]);
    assert.deepEqual(two.map((slot) => Boolean(slot.optional)), [false, false, false, false, true]);
    assert.deepEqual(focusSlots(["chest", "arms"], "gym", owned), focusSlots(["arms", "chest", "arms"], "gym", owned), "order and repeats do not matter");
    const many = focusSlots([...FOCUS_AREAS], "gym", owned, { level: "beginner" });
    assert.equal(many.length, 8);
    assert.deepEqual(many.map((slot) => slot.focus), [...FOCUS_AREAS]);
    assert.ok(many.every((slot) => !slot.optional), "one required slot for each of many areas");
  });

  test("the same movement for two areas is done once (legs and glutes both hinge)", () => {
    const slots = focusSlots(["legs", "glutes"], "gym", PROFILES.gym.owned, { level: "advanced" });
    const labels = slots.map((slot) => slot.label);
    assert.equal(new Set(labels).size, labels.length, labels.join(", "));
    assert.equal(labels.filter((label) => label === "Hinge").length, 1);
  });

  test("full body uses FITX's authored full-body days: the gym's with free weights, bodyweight ones at home without", () => {
    const gymDays = programmeById("full-body-3")!.days.map((day) => day.slots);
    const homeDays = programmeById("home-bodyweight-3")!.days.map((day) => day.slots);
    assert.equal(gymDays.length, 3);
    assert.equal(homeDays.length, 3);
    assert.equal(focusTemplate("full_body", "gym", PROFILES.gym.owned), gymDays[0], "no seed: day A");
    assert.equal(focusTemplate("full_body", "home", PROFILES["home-none"].owned), homeDays[0]);
    assert.equal(focusTemplate("full_body", "home", PROFILES["home-db"].owned), gymDays[0], "dumbbells at home: the loaded days");
    const picked = new Set(Array.from({ length: 30 }, (_, index) => focusTemplate("full_body", "gym", PROFILES.gym.owned, `2026-11-${index + 1}`)));
    assert.equal(picked.size, 3, "the seed rotates the three days");
    assert.equal(focusTemplate("full_body", "gym", PROFILES.gym.owned, "a seed"), focusTemplate("full_body", "gym", PROFILES.gym.owned, "a seed"));
    assert.equal(focusTemplate("chest", "home", PROFILES["home-none"].owned), FOCUS_TEMPLATES.chest);
  });

  for (const level of LEVELS) {
    for (const profile of Object.keys(PROFILES)) {
      test(`${level} at ${profile}: every exercise trains its area, is doable and fits the level`, () => {
        for (const area of FOCUS_AREAS) {
          const ctx = ctxFor(profile, level);
          const day = generateFocusDay([area], ctx);
          assert.deepEqual(day.unfilled, [], `${area}: slots that cannot be filled are left out, not reported empty`);
          assert.equal(new Set(day.items.map((item) => item.exercise.id)).size, day.items.length, `${area}: no repeats`);
          assert.ok(day.items.length <= focusSlotBudget(level, 1));
          for (const item of day.items) {
            assert.ok(isDoableWith(item.exercise.required_equipment, ctx.owned), `${area}: ${item.exercise.id} needs ${item.exercise.required_equipment}`);
            assert.ok(levelRank(item.exercise.difficulty) <= levelRank(level) + 1, `${area}: ${item.exercise.id} is ${item.exercise.difficulty}`);
            if (area !== "full_body") assert.ok(focusRole(item.exercise, area), `${area}: ${item.exercise.name} does not train it`);
            assert.notEqual(item.exercise.category, "stretching");
          }
          if (profile === "gym") {
            assert.deepEqual(day.short, [], `${area}: a gym has enough`);
            const available = focusTemplate(area, ctx.context!, ctx.owned, ctx.seed).length;
            assert.equal(day.items.length, Math.min(focusSlotBudget(level, 1), available), `${area}: a full session`);
          }
          // Asked to fit: the same picks, in the same order, as generateDay on the same slots.
          const again = generateDay(focusSlots([area], ctx.context!, ctx.owned, { catalog, level, seed: ctx.seed }), ctx);
          assert.deepEqual(again.items.map((item) => item.exercise.id), day.items.map((item) => item.exercise.id));
        }
      });
    }
  }

  test("arms prioritise arm exercises, abs abdominal ones, and full body reaches the upper and the lower body", () => {
    for (const profile of ["gym", "home-db"]) {
      const arms = generateFocusDay(["arms"], ctxFor(profile, "intermediate"));
      assert.ok(arms.items.length >= 4);
      for (const item of arms.items) assert.ok(["biceps", "triceps", "forearms"].includes(item.exercise.muscle_group), item.exercise.name);
      const abs = generateFocusDay(["abs"], ctxFor(profile, "intermediate"));
      for (const item of abs.items) assert.equal(item.exercise.muscle_group, "core", item.exercise.name);
    }
    for (const profile of Object.keys(PROFILES)) {
      const full = generateFocusDay(["full_body"], ctxFor(profile, "beginner"));
      const regions = full.items.flatMap((item) => exerciseRegions(item.exercise.primary_muscle, []).primary);
      assert.ok(regions.some((region) => UPPER.has(region)) && regions.some((region) => LOWER.has(region)), `${profile}: ${regions}`);
      assert.ok(new Set(regions).size >= 3, `${profile}: at least three muscles`);
    }
  });

  test("chest with dumbbells only: chest exercises dumbbells allow", () => {
    const owned = expandOwnedEquipment(["dumbbell"]);
    const day = generateFocusDay(["chest"], { catalog, owned, level: "beginner", seed: "s", context: "home" });
    assert.ok(day.items.length >= 3);
    for (const item of day.items) {
      assert.ok(item.exercise.required_equipment.every((key) => key === "dumbbell"), item.exercise.name);
      assert.equal(focusRole(item.exercise, "chest"), "primary", item.exercise.name);
    }
  });

  test("an area the equipment cannot serve comes back short instead of padded with other muscles", () => {
    const shoulders = generateFocusDay(["shoulders"], ctxFor("home-none", "beginner"));
    assert.deepEqual(shoulders.items, []);
    assert.deepEqual(shoulders.short, ["shoulders"]);
    const back = generateFocusDay(["back"], ctxFor("home-none", "beginner"));
    assert.deepEqual(back.items.map((item) => item.exercise.id), ["free-exercise-db-Superman"]);
    assert.deepEqual(back.short, ["back"]);
    // Without a catalogue the same slots go to generateDay, which reports what it could not fill.
    const blind = generateDay(focusSlots(["shoulders"], "home", PROFILES["home-none"].owned), ctxFor("home-none", "beginner"));
    assert.ok(blind.unfilled.length > 0);
    assert.ok(blind.items.every((item) => focusRole(item.exercise, "shoulders")), "the shrug slot takes traps work only");
  });

  test("deterministic, and a short session drops optional slots only", () => {
    const ctx = ctxFor("gym", "advanced");
    assert.deepEqual(generateFocusDay(["back", "arms"], ctx), generateFocusDay(["arms", "back"], ctx));
    const short = generateFocusDay(["back", "arms"], { ...ctx, sessionMinutes: 30 });
    assert.ok(short.dropped.length > 0);
    assert.ok(short.dropped.every((slot) => slot.optional));
    assert.ok(short.items.filter((item) => !item.slot.optional).length >= 4, "two required slots for each area");
    const other = generateFocusDay(["back", "arms"], { ...ctx, seed: "another day" });
    assert.ok(other.items.length > 0);
  });

  test("a hard primary filter: primaryOnly keeps a slot to its muscles", () => {
    const small: CatalogExercise[] = [get("free-exercise-db-Superman"), get("free-exercise-db-Barbell_Shrug")];
    const ctx: GenerationContext = { catalog: small, owned: expandOwnedEquipment([]), level: "beginner", seed: "x" };
    const soft: SlotSpec = { muscle: "back", sets: 3, reps: [10, 12], rest: 60, primary: ["traps"] };
    const hard: SlotSpec = { ...soft, primaryOnly: true };
    assert.deepEqual(slotCandidates(soft, ctx, new Set()).map((exercise) => exercise.id), ["free-exercise-db-Superman"]);
    assert.deepEqual(slotCandidates(hard, ctx, new Set()), []);
    assert.equal(pickForSlot(hard, { ...ctx, owned: expandOwnedEquipment(["barbell"]) }, new Set())?.id, "free-exercise-db-Barbell_Shrug");
  });
});
