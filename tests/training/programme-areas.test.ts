import { test } from "node:test";
import assert from "node:assert/strict";
import { PROGRAMMES, programmeById } from "@/data/programmes";
import { PROGRAMME_META, programmeLengthLabel, programmeMeta } from "@/data/programmes/meta";
import { FOCUS_AREA_INFO } from "@/lib/training/focus";
import {
  areaForGroup, isFullBodyProgramme, programmeAreaShares, programmeAreas, programmeRegionLevels, programmesForArea, slotPrescription, weeklyPattern,
} from "@/lib/training/programmes";

const ids = (list: ReadonlyArray<{ id: string }>) => list.map((item) => item.id);

test("every authored programme has a length and an objective, in code, by id", () => {
  for (const programme of PROGRAMMES) {
    const meta = programmeMeta(programme.id);
    assert.ok(meta, `${programme.id} has metadata`);
    assert.ok(meta.lengthDays === null || (Number.isInteger(meta.lengthDays) && meta.lengthDays >= 7 && meta.lengthDays <= 120), `${programme.id} length`);
    assert.ok(meta.objective.length > 10 && meta.objective.endsWith("."), `${programme.id} objective is a sentence`);
  }
  assert.deepEqual(Object.keys(PROGRAMME_META).sort(), ids(PROGRAMMES).sort(), "no metadata for programmes that do not exist");
  assert.equal(programmeMeta("not-a-programme"), null);
  assert.equal(programmeMeta("constructor"), null);
});

test("lengths read as days or whole weeks", () => {
  assert.equal(programmeLengthLabel(30), "30-day plan");
  assert.equal(programmeLengthLabel(42), "6-week plan");
  assert.equal(programmeLengthLabel(56), "8-week plan");
  assert.equal(programmeLengthLabel(null), "Ongoing");
});

test("muscle groups map to the focus areas; the neck to none", () => {
  assert.equal(areaForGroup("biceps"), "arms");
  assert.equal(areaForGroup("core"), "abs");
  assert.equal(areaForGroup("hips"), "legs");
  assert.equal(areaForGroup("glutes"), "glutes");
  assert.equal(areaForGroup("neck"), null);
});

test("a programme's sets are shared out over the body areas from its required slots", () => {
  for (const programme of PROGRAMMES) {
    const shares = programmeAreaShares(programme);
    const total = shares.reduce((sum, entry) => sum + entry.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${programme.id} shares add up to 100%`);
    assert.ok(shares.every((entry, index) => index === 0 || shares[index - 1].sets >= entry.sets), `${programme.id} most first`);
  }
  // Push, Pull, Legs: push 4+3+3+3+3, pull 4+3+3+3, legs 4+3+3+3+3 working sets (optional slots left out).
  const ppl = programmeAreaShares(programmeById("ppl-3")!);
  const sets = Object.fromEntries(ppl.map((entry) => [entry.area, entry.sets]));
  assert.deepEqual(sets, { chest: 7, shoulders: 9, arms: 6, back: 7, legs: 16 });
});

test("full-body programmes train the upper and lower body every day", () => {
  assert.deepEqual(ids(PROGRAMMES.filter(isFullBodyProgramme)), ["full-body-3", "home-bodyweight-3"]);
  assert.deepEqual(ids(programmesForArea(PROGRAMMES, "full_body")), ["full-body-3", "home-bodyweight-3"]);
  assert.equal(programmeAreas(programmeById("full-body-3")!)[0], "full_body");
  assert.ok(!programmeAreas(programmeById("ppl-3")!).includes("full_body"));
});

test("browsing by area lists the programmes that train it, the most work for it first", () => {
  const arms = programmesForArea(PROGRAMMES, "arms");
  assert.ok(arms.length > 0 && arms.every((programme) => programmeAreaShares(programme).some((entry) => entry.area === "arms")));
  const share = (id: string) => programmeAreaShares(programmeById(id)!).find((entry) => entry.area === "arms")?.share ?? 0;
  assert.ok(arms.every((programme, index) => index === 0 || share(arms[index - 1].id) >= share(programme.id)));
  assert.equal(arms[0].id, "bro-split-5", "the split with an arms day leads");
  assert.ok(!ids(programmesForArea(PROGRAMMES, "glutes")).includes("bro-split-5"), "no required glute work in the bro split");
});

test("the body-map heat puts the busiest area at full strength and lights each area's regions", () => {
  const levels = programmeRegionLevels(programmeById("ppl-3")!);
  assert.equal(Math.max(...Object.values(levels)), 1);
  for (const region of FOCUS_AREA_INFO.legs.regions) assert.equal(levels[region], 1, `${region}: legs have the most sets`);
  assert.ok((levels.chest ?? 0) > 0 && (levels.chest ?? 0) < 1);
  assert.deepEqual(programmeRegionLevels({ days: [] }), {});
});

test("slot prescriptions and weekly patterns read plainly", () => {
  assert.equal(slotPrescription({ sets: 4, reps: [6, 8] }), "4 × 6–8");
  assert.equal(slotPrescription({ sets: 3, reps: [12, 12] }), "3 × 12");
  assert.equal(slotPrescription({ sets: 3, reps: [10, 15], seconds: 40 }), "3 × 40 s");
  assert.deepEqual(weeklyPattern([1, 3, 5]), { training: 3, rest: 4 });
  assert.deepEqual(weeklyPattern([1, 1, 9]), { training: 1, rest: 6 });
});
