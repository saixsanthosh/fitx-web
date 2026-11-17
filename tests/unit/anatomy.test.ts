import test from "node:test";
import assert from "node:assert/strict";
// The catalogue as the migrations create it (scripts/catalog), so every stored muscle value is checked.
import { loadCatalog } from "../../scripts/catalog/catalog.mjs";
import { BODY_ART, BODY_VIEWBOX, type BodyView } from "@/components/anatomy/body-paths";
import {
  BODY_REGIONS, PRIMARY_SET_CREDIT, REGIONS, SECONDARY_SET_CREDIT, exerciseRegions, groupForRegion, isBroadMuscleWord, isRegionKey, listRegions,
  loadLevels, loadShare, muscleLoad, regionInView, regionsForGroup, regionsForMuscle, type RegionKey,
} from "@/lib/training/anatomy";
import { MUSCLE_GROUPS, MUSCLE_TO_GROUP, type MuscleGroup } from "@/lib/training/taxonomy";

type Row = { primary_muscle: string; secondary_muscles: string[]; is_active: boolean };
const active = (loadCatalog() as Row[]).filter((row) => row.is_active);
const VIEWS: BodyView[] = ["front", "back"];
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

test("the catalogue under test is the one production holds", () => {
  assert.equal(active.length, 883);
  assert.equal(active.filter((row) => row.secondary_muscles.length > 0).length, 616);
});

test("every muscle value in the catalogue maps to at least one region (cardio is full body: none)", () => {
  const values = new Set(active.flatMap((row) => [row.primary_muscle, ...row.secondary_muscles]));
  assert.ok(values.has("lower_back") && values.has("middle_back"), "the catalogue spells them with underscores");
  for (const value of values) {
    if (MUSCLE_TO_GROUP[value] === "full_body") {
      assert.deepEqual(regionsForMuscle(value), [], value);
      continue;
    }
    assert.ok(regionsForMuscle(value).length > 0, `no region for "${value}"`);
  }
  assert.deepEqual(regionsForMuscle("cardio"), []);
});

test("region keys are the catalogue's primary muscles and agree with the taxonomy groups", () => {
  for (const key of BODY_REGIONS) {
    assert.equal(REGIONS[key].key, key);
    assert.equal(groupForRegion(key), MUSCLE_TO_GROUP[key], key);
    assert.deepEqual(regionsForMuscle(key), [key]);
  }
  assert.equal(new Set(BODY_REGIONS).size, BODY_REGIONS.length);
});

test("spelling does not matter; unknown and odd values map to nothing", () => {
  for (const spelling of ["lower back", "Lower Back", "lower-back", "  LOWER_BACK ", "lower__back"]) assert.deepEqual(regionsForMuscle(spelling), ["lower_back"]);
  assert.deepEqual(regionsForMuscle("Middle back"), ["middle_back"]);
  assert.deepEqual(regionsForMuscle("front deltoids"), ["shoulders"]);
  assert.deepEqual(regionsForMuscle("rear_deltoids"), ["shoulders"]);
  assert.deepEqual(regionsForMuscle("upper_chest"), ["chest"]);
  assert.deepEqual(regionsForMuscle("core"), ["abdominals"]);
  assert.deepEqual(regionsForMuscle("hip_flexors"), ["quadriceps"]);
  assert.deepEqual(regionsForMuscle("ankles"), ["calves"]);
  assert.deepEqual(regionsForMuscle("back"), regionsForGroup("back"));
  assert.deepEqual(regionsForMuscle("hips"), ["abductors", "adductors"]);
  for (const unknown of ["", "  ", "wings", "full_body", "constructor", "__proto__", "toString"]) assert.deepEqual(regionsForMuscle(unknown), [], unknown);
  assert.deepEqual(regionsForMuscle(undefined as unknown as string), []);
  assert.equal(isRegionKey("lats"), true);
  assert.equal(isRegionKey("lower back"), false);
  assert.equal(isRegionKey(null), false);
});

test("every muscle group but full body has regions, and each region belongs to exactly one group", () => {
  assert.deepEqual(regionsForGroup("back"), ["traps", "lats", "middle_back", "lower_back"]);
  assert.deepEqual(regionsForGroup("core"), ["abdominals"]);
  assert.deepEqual(regionsForGroup("hips"), ["abductors", "adductors"]);
  assert.deepEqual(regionsForGroup("full_body"), []);
  const seen: RegionKey[] = [];
  for (const group of MUSCLE_GROUPS) {
    const regions = regionsForGroup(group as MuscleGroup);
    if (group === "full_body") continue;
    assert.ok(regions.length > 0, `group ${group} has no region`);
    for (const region of regions) assert.equal(groupForRegion(region), group);
    seen.push(...regions);
  }
  assert.deepEqual([...seen].sort(), [...BODY_REGIONS].sort());
  regionsForGroup("back").pop();
  assert.equal(regionsForGroup("back").length, 4, "callers get a copy");
});

test("every region is drawn, on the side its metadata names, with non-empty left and right paths", () => {
  for (const key of BODY_REGIONS) {
    const drawnOn = VIEWS.filter((view) => BODY_ART[view].regions[key]);
    assert.ok(drawnOn.length > 0, `${key} is not drawn`);
    const expected = REGIONS[key].views === "both" ? ["front", "back"] : [REGIONS[key].views];
    assert.deepEqual(drawnOn, expected, `${key} views`);
    for (const view of VIEWS) assert.equal(regionInView(key, view), drawnOn.includes(view));
  }
  for (const view of VIEWS) {
    const art = BODY_ART[view];
    for (const [key, paths] of Object.entries(art.regions)) {
      assert.ok(isRegionKey(key), `${view}: unknown region ${key}`);
      assert.ok(paths && paths.length >= 2 && paths.length % 2 === 0, `${view} ${key}: a left and a right side`);
      for (const d of paths ?? []) assert.match(d, /^M[\d.\s-]+(C[\d.\s-]+)+Z$/, `${view} ${key}`);
    }
    assert.match(art.silhouette, /^M[\d.\s-]+(C[\d.\s-]+)+Z$/);
    for (const d of art.details) assert.match(d, /^M[\d.\s-]+(C[\d.\s-]+)+Z$/);
  }
});

test("the artwork stays inside the viewBox and is symmetric", () => {
  const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const bounds = (values: number[]) => {
    const xs = values.filter((_, index) => index % 2 === 0);
    const ys = values.filter((_, index) => index % 2 === 1);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  // Every point of the path (control points included), or only the points the curve passes through.
  const box = (d: string) => bounds(numbers(d));
  const anchors = (d: string) => bounds(d.slice(1, -1).split("C").flatMap((chunk) => numbers(chunk).slice(-2)));
  const vbRight = BODY_VIEWBOX.x + BODY_VIEWBOX.width;
  const vbBottom = BODY_VIEWBOX.y + BODY_VIEWBOX.height;
  const centre = BODY_VIEWBOX.x + BODY_VIEWBOX.width / 2;
  for (const view of VIEWS) {
    const art = BODY_ART[view];
    const outline = anchors(art.silhouette);
    for (const d of [art.silhouette, ...art.details, ...Object.values(art.regions).flat()]) {
      const all = box(d ?? "");
      assert.ok(all.minX >= BODY_VIEWBOX.x && all.maxX <= vbRight && all.minY >= BODY_VIEWBOX.y && all.maxY <= vbBottom, `${view}: path outside the viewBox`);
    }
    assert.ok(Math.abs(outline.minX + outline.maxX - 2 * centre) < 0.2, `${view} silhouette symmetric`);
    for (const [key, paths] of Object.entries(art.regions)) {
      for (let index = 0; index < (paths ?? []).length; index += 2) {
        const left = anchors(paths![index]);
        const right = anchors(paths![index + 1]);
        assert.ok(left.maxX < centre && right.minX > centre, `${view} ${key}: left then right`);
        assert.ok(Math.abs(left.minX + right.maxX - 2 * centre) < 0.2 && Math.abs(left.maxX + right.minX - 2 * centre) < 0.2, `${view} ${key}: mirrored`);
        assert.ok(Math.abs(left.minY - right.minY) < 0.05 && Math.abs(left.maxY - right.maxY) < 0.05, `${view} ${key}: same height`);
        assert.ok(right.maxX <= outline.maxX && right.minY >= outline.minY && right.maxY <= outline.maxY, `${view} ${key}: inside the figure`);
      }
    }
  }
});

test("muscleLoad: 1 per set for the primary muscle, 0.5 per set for each secondary", () => {
  const load = muscleLoad([
    { primary: "chest", secondary: ["triceps", "front_deltoids"], sets: 4 },
    { primary: "shoulders", secondary: ["triceps"], sets: 3 },
    { primary: "Lower Back", secondary: null, sets: 2 },
  ]);
  assert.equal(PRIMARY_SET_CREDIT, 1);
  assert.equal(SECONDARY_SET_CREDIT, 0.5);
  assert.equal(load.chest, 4);
  assert.equal(load.triceps, 3.5);
  assert.equal(load.shoulders, 5);
  assert.equal(load.lower_back, 2);
  assert.equal(load.lats, 0);
  assert.deepEqual(Object.keys(load).sort(), [...BODY_REGIONS].sort());
  assert.equal(sum(Object.values(load)), 14.5);
});

test("muscleLoad counts a region once per exercise, at its highest role, and ignores what it cannot place", () => {
  // A secondary that repeats the primary, two secondaries on one region, a broad group word, unknown and empty values.
  const load = muscleLoad([
    { primary: "hamstrings", secondary: ["hamstrings", "glutes", "back", "wings", ""], sets: 3 },
    { primary: "shoulders", secondary: ["front_deltoids", "rear_deltoids"], sets: 1 },
    { primary: "cardio", secondary: ["calves"], sets: 2 },
    { primary: null, secondary: ["forearms"], sets: 2 },
    { primary: "made up", sets: 5 },
  ]);
  assert.equal(load.hamstrings, 3);
  assert.equal(load.glutes, 1.5);
  // "back" on a hinge does not say which back muscle assists, so none is credited (C3: never guessed).
  for (const region of ["traps", "lats", "middle_back", "lower_back"] as const) assert.equal(load[region], 0);
  assert.equal(load.shoulders, 1);
  assert.equal(load.calves, 1);
  assert.equal(load.forearms, 1);
  assert.equal(sum(Object.values(load)), 3 + 1.5 + 1 + 1 + 1);
});

test("muscleLoad: empty input and sets that are not positive numbers give zero", () => {
  const empty = muscleLoad([]);
  assert.ok(BODY_REGIONS.every((key) => empty[key] === 0));
  const odd = muscleLoad([
    { primary: "chest", sets: 0 },
    { primary: "chest", sets: -3 },
    { primary: "chest", sets: Number.NaN },
    { primary: "chest", sets: Number.POSITIVE_INFINITY },
  ]);
  assert.ok(BODY_REGIONS.every((key) => odd[key] === 0));
  assert.equal(muscleLoad([{ primary: "chest", sets: 2.5 }]).chest, 2.5);
});

test("loadShare: percentages that add up to 100, or all zero without load", () => {
  const share = loadShare(muscleLoad([
    { primary: "chest", secondary: ["triceps", "shoulders"], sets: 4 },
    { primary: "quadriceps", secondary: ["glutes"], sets: 3 },
  ]));
  // chest 4, triceps 2, shoulders 2, quadriceps 3, glutes 1.5: 12.5 in all.
  assert.equal(share.chest, 32);
  assert.equal(share.quadriceps, 24);
  assert.equal(share.glutes, 12);
  assert.equal(share.lats, 0);
  assert.ok(Math.abs(sum(Object.values(share)) - 100) < 1e-9);
  assert.ok(Object.values(share).every((value) => value >= 0 && value <= 100));
  const none = loadShare({});
  assert.ok(BODY_REGIONS.every((key) => none[key] === 0));
  const partial = loadShare({ calves: 3, neck: -1, lats: Number.NaN });
  assert.equal(partial.calves, 100);
  assert.equal(partial.neck, 0);
  assert.equal(partial.lats, 0);
});

test("loadLevels: relative to the busiest region, 0 without load", () => {
  const levels = loadLevels({ chest: 4, triceps: 2, shoulders: 1, biceps: 0 });
  assert.equal(levels.chest, 1);
  assert.equal(levels.triceps, 0.5);
  assert.equal(levels.shoulders, 0.25);
  assert.equal(levels.biceps, 0);
  assert.equal(levels.calves, 0);
  assert.ok(Object.values(levels).every((value) => value >= 0 && value <= 1));
  const none = loadLevels(muscleLoad([]));
  assert.ok(BODY_REGIONS.every((key) => none[key] === 0));
});

test("isBroadMuscleWord: group words over several regions, not regions, aliases or one-region groups", () => {
  for (const word of ["back", "Back ", "hips", "HIPS"]) assert.equal(isBroadMuscleWord(word), true, word);
  for (const word of ["lower_back", "lats", "upper_back", "erectors", "core", "abdominals", "cardio", "full_body", "wings", ""]) {
    assert.equal(isBroadMuscleWord(word), false, word);
  }
  assert.equal(isBroadMuscleWord(42 as unknown as string), false);
});

test("exerciseRegions and listRegions, for the two-tone map and its label", () => {
  assert.deepEqual(exerciseRegions("chest", ["triceps", "front_deltoids", "upper_chest", "shoulders"]), { primary: ["chest"], secondary: ["triceps", "shoulders"] });
  assert.deepEqual(exerciseRegions("lats", ["back", "biceps"]), { primary: ["lats"], secondary: ["biceps"] });
  // The starter Romanian deadlift rows: hamstrings with glutes and a bare "back".
  assert.deepEqual(exerciseRegions("hamstrings", ["glutes", "back"]), { primary: ["hamstrings"], secondary: ["glutes"] });
  assert.deepEqual(exerciseRegions("glutes", ["Hips", "core", "lower back"]), { primary: ["glutes"], secondary: ["abdominals", "lower_back"] });
  // A broad primary still covers its group: only an assisting muscle has to be named precisely.
  assert.deepEqual(exerciseRegions("back", ["biceps"]), { primary: ["traps", "lats", "middle_back", "lower_back"], secondary: ["biceps"] });
  assert.deepEqual(exerciseRegions(null, null), { primary: [], secondary: [] });
  assert.equal(listRegions([]), "");
  assert.equal(listRegions(["chest"]), "chest");
  assert.equal(listRegions(["chest", "lower_back"]), "chest and lower back");
  assert.equal(listRegions(["chest", "shoulders", "triceps"]), "chest, shoulders and triceps");
});
