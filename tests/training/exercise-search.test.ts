import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { toCatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import {
  catalogSearchQuery,
  clampInt,
  containsPattern,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SEARCH_PARAMS,
  difficultyWindows,
  escapeLike,
  filterCatalog,
  loadCatalogThumbnails,
  MAX_IDS,
  MAX_IDS_LENGTH,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  normalizeQuery,
  pageRange,
  paginate,
  parseCatalogSearchParams,
  searchCatalog,
  searchWords,
  sortCatalog,
  type CatalogSearchParams,
} from "@/lib/training/catalog-search";
import { PINNED_PHOTO_BASE } from "@/lib/training/media";
import {
  activeFilterCount,
  browseByMuscleHref,
  canonicalLibrarySearch,
  DEFAULT_LIBRARY_STATE,
  filterChips,
  libraryQuery,
  muscleWordFilter,
  panelFilterCount,
  readLibraryState,
  relaxLabel,
  relaxState,
  withLibraryParam,
  withoutChip,
  withoutFilters,
  withoutLibraryFilters,
  writeLibraryState,
} from "@/app/(dashboard)/exercises/_lib/library-state";
import { makeJwt, SESSION_COOKIE, ssrCookieValue } from "../support/fake-supabase.ts";

const params = (overrides: Partial<CatalogSearchParams> = {}): CatalogSearchParams => ({ ...DEFAULT_SEARCH_PARAMS, ...overrides });
const parse = (query: string) => parseCatalogSearchParams(new URLSearchParams(query));

// ---------------------------------------------------------------- query parameters

describe("parseCatalogSearchParams", () => {
  test("defaults when nothing is given", () => {
    assert.deepEqual(parse(""), DEFAULT_SEARCH_PARAMS);
    assert.equal(DEFAULT_SEARCH_PARAMS.pageSize, 24);
  });

  test("reads every known parameter; a single value still works for every list", () => {
    assert.deepEqual(parse("q=bench%20press&muscle_group=chest&category=strength&difficulty=beginner&location=home&equipment=dumbbell&doable=dumbbell,bench&ids=push_up,bench_press&sort=difficulty&page=3&pageSize=12"), {
      ...DEFAULT_SEARCH_PARAMS,
      q: "bench press", muscleGroups: ["chest"], categories: ["strength"], difficulties: ["beginner"], location: "home", equipment: ["dumbbell"],
      doable: ["dumbbell", "bench"], ids: ["push_up", "bench_press"], sort: "difficulty", page: 3, pageSize: 12,
    });
  });

  test("lists: several values, OR within a kind; focus, regions, movement, mechanic and best match", () => {
    assert.deepEqual(parse("muscle_group=chest,back,lats&primary=lats,quadriceps,nope&focus=arms,Lower%20body&category=strength,olympic&difficulty=advanced,beginner&equipment=none,machines,barbell,jetpack&movement=pull,hold&mechanic=compound&sort=best"), {
      ...DEFAULT_SEARCH_PARAMS,
      muscleGroups: ["chest", "back"], primary: ["lats", "quadriceps"], focus: ["arms", "legs"], categories: ["strength", "olympic"],
      difficulties: ["advanced", "beginner"], equipment: ["none", "machines", "barbell"], movements: ["pull", "hold"], mechanics: ["compound"], sort: "best",
    });
  });

  test("ignores unknown keys and drops unknown values", () => {
    const result = parse("muscle_group=lats&category=yoga&difficulty=expert&location=office&equipment=treadmill&sort=random&movement=sideways&mechanic=both&focus=elbows&primary=wings&foo=bar");
    assert.deepEqual(result, DEFAULT_SEARCH_PARAMS);
  });

  test("clamps page and page size", () => {
    assert.deepEqual([parse("page=abc").page, parse("page=0").page, parse("page=-4").page, parse("page=2.9").page, parse("page=99999999").page], [1, 1, 1, 2, MAX_PAGE]);
    assert.deepEqual([parse("pageSize=").pageSize, parse("pageSize=x").pageSize, parse("pageSize=0").pageSize, parse("pageSize=500").pageSize, parse("pageSize=48").pageSize], [DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 48]);
    assert.equal(clampInt(" 7 ", 1, 1, 10), 7);
  });

  test("doable: absent is no filter, empty is body weight only, unknown keys drop out", () => {
    assert.equal(parse("").doable, null);
    assert.deepEqual(parse("doable=").doable, []);
    assert.deepEqual(parse("doable=dumbbell,%20bench%20,dumbbell,jetpack,,").doable, ["dumbbell", "bench"]);
    assert.deepEqual(parse("doable=jetpack").doable, []);
  });

  test("ids are validated, de-duplicated and capped", () => {
    assert.deepEqual(parse("ids=push_up,free-exercise-db-3_4_Sit-Up,push_up,bad%20id,a.b,%3Cscript%3E").ids, ["push_up", "free-exercise-db-3_4_Sit-Up"]);
    const many = Array.from({ length: MAX_IDS + 20 }, (_, index) => `id_${index}`).join(",");
    assert.equal(parse(`ids=${many}`).ids?.length, MAX_IDS);
    assert.deepEqual(parse("ids=").ids, []);
    // Long ids stop at about 4 000 characters, keeping the first (newest) ones.
    const long = Array.from({ length: 80 }, (_, index) => `${"x".repeat(96)}_${String(index).padStart(2, "0")}`);
    const kept = parse(`ids=${long.join(",")}`).ids ?? [];
    assert.deepEqual(kept, long.slice(0, 40));
    assert.ok(kept.join(",").length <= MAX_IDS_LENGTH);
  });

  test("the search text is single-spaced, trimmed and capped", () => {
    assert.equal(parse("q=%20%20bench%20%20%20press%20").q, "bench press");
    assert.equal(normalizeQuery("x".repeat(200)).length, 80);
  });

  test("catalogSearchQuery writes what parseCatalogSearchParams reads", () => {
    const original = params({
      q: "row", muscleGroups: ["back", "biceps"], primary: ["lats"], focus: ["back"], categories: ["strength"], difficulties: ["advanced", "intermediate"], location: "gym",
      equipment: ["barbell", "none"], doable: ["bench", "barbell"], movements: ["pull"], mechanics: ["compound"], ids: ["a", "b"], sort: "difficulty", page: 4, pageSize: 12,
    });
    assert.deepEqual(parseCatalogSearchParams(catalogSearchQuery(original)), { ...original, doable: ["barbell", "bench"] });
    assert.equal(catalogSearchQuery(params({ sort: "best" })).toString(), "sort=best");
    assert.equal(catalogSearchQuery(params()).toString(), "");
    assert.equal(catalogSearchQuery(params({ doable: [] })).toString(), "doable=");
  });
});

describe("name search", () => {
  test("words: lower-case, edge punctuation and wildcards removed, de-duplicated, at most six", () => {
    assert.deepEqual(searchWords("  Bench, PRESS bench "), ["bench", "press"]);
    assert.deepEqual(searchWords("push-up 3/4 (pull"), ["push-up", "3/4", "pull"]);
    assert.deepEqual(searchWords("* ** a*b"), ["a", "b"]);
    assert.deepEqual(searchWords("développé couché"), ["développé", "couché"]);
    assert.equal(searchWords("a b c d e f g h").length, 6);
    assert.deepEqual(searchWords(""), []);
  });

  test("LIKE wildcards and the escape character match literally", () => {
    assert.equal(escapeLike("100%_off\\"), "100\\%\\_off\\\\");
    assert.equal(containsPattern("a_b"), "%a\\_b%");
    assert.equal(escapeLike("plain"), "plain");
  });
});

// ---------------------------------------------------------------- the catalogue used below

type Row = Record<string, unknown>;
type CatalogueState = "legacy" | "uncurated" | "curated";

const LEGACY_ROWS: Row[] = [
  { id: "bench_press", name: "Barbell Bench Press", primary_muscle: "chest", secondary_muscles: ["triceps"], equipment: ["barbell", "bench"], locations: ["gym"], difficulty: "intermediate", movement_pattern: "horizontal_push" },
  { id: "push_up", name: "Push-Up", primary_muscle: "chest", secondary_muscles: ["triceps"], equipment: ["bodyweight"], locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "horizontal_push" },
  { id: "dumbbell_bench_press", name: "Dumbbell Bench Press", primary_muscle: "chest", secondary_muscles: [], equipment: ["dumbbell", "bench"], locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "horizontal_push" },
  { id: "free-exercise-db-Pullups", name: "Pullups", primary_muscle: "lats", secondary_muscles: ["biceps"], equipment: ["body only"], locations: ["gym", "home"], difficulty: "intermediate", movement_pattern: "pull" },
  { id: "free-exercise-db-Hamstring_Stretch", name: "Hamstring Stretch", primary_muscle: "hamstrings", secondary_muscles: [], equipment: ["body only"], locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "static" },
  { id: "free-exercise-db-Barbell_Squat", name: "Barbell Squat", primary_muscle: "quadriceps", secondary_muscles: ["glutes"], equipment: ["barbell"], locations: ["gym", "home"], difficulty: "advanced", movement_pattern: "squat" },
  { id: "row_a_b", name: "Row Variation A_B", primary_muscle: "middle_back", secondary_muscles: [], equipment: ["cable"], locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "pull" },
  { id: "row_axb", name: "Row Variation AXB", primary_muscle: "middle_back", secondary_muscles: [], equipment: ["cable"], locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "pull" },
  { id: "old_bench_press", name: "Old Bench Press Duplicate", primary_muscle: "chest", secondary_muscles: [], equipment: ["barbell"], locations: ["gym"], difficulty: "beginner", movement_pattern: "horizontal_push", is_active: false },
];

/** What the clean-up migration would write; row_axb is left uncurated on purpose. */
const CURATED_VALUES: Record<string, Row> = {
  bench_press: { category: "strength", mechanic: "compound", muscle_group: "chest", required_equipment: ["barbell", "bench"], locations: ["gym"] },
  push_up: { category: "strength", mechanic: "compound", muscle_group: "chest", required_equipment: [], locations: ["gym", "home"], source_ref: "Pushups" },
  dumbbell_bench_press: { category: "strength", mechanic: "compound", muscle_group: "chest", required_equipment: ["dumbbell", "bench"], locations: ["gym", "home"] },
  "free-exercise-db-Pullups": { category: "strength", mechanic: "compound", muscle_group: "back", required_equipment: ["pull_up_bar"], locations: ["gym", "home"], source_ref: "Pullups" },
  "free-exercise-db-Hamstring_Stretch": { category: "stretching", mechanic: null, muscle_group: "hamstrings", required_equipment: [], locations: ["gym", "home"], prescription_type: "time", default_duration_seconds: 30, source_ref: "Hamstring_Stretch" },
  "free-exercise-db-Barbell_Squat": { category: "strength", mechanic: "compound", muscle_group: "quadriceps", required_equipment: ["barbell", "squat_rack"], locations: ["gym"], source_ref: "Barbell_Squat" },
  row_a_b: { category: "strength", mechanic: "compound", muscle_group: "back", required_equipment: ["cable_machine"], locations: ["gym"] },
  old_bench_press: { category: "strength", mechanic: "compound", muscle_group: "chest", required_equipment: ["barbell"], locations: ["gym"] },
};

const V2_DEFAULTS: Row = { category: null, mechanic: null, muscle_group: null, required_equipment: [], prescription_type: "reps", default_duration_seconds: null, source_ref: null, merged_into: null, catalog_version: 0 };

function catalogue(state: CatalogueState): Row[] {
  return LEGACY_ROWS.map((row) => {
    const base: Row = { secondary_muscles: [], recommended_sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, alternatives: [], is_active: true, description: "", instructions: [], attribution: "test", ...row };
    if (state === "legacy") return base;
    const curated = state === "curated" ? CURATED_VALUES[String(row.id)] : undefined;
    return { ...base, ...V2_DEFAULTS, ...(curated ? { ...curated, catalog_version: 1 } : {}) };
  });
}

const names = (items: ReadonlyArray<{ name: string }>) => items.map((item) => item.name);

// ---------------------------------------------------------------- in-memory search (before the clean-up)

describe("in-memory search over estimated exercises", () => {
  const exercises = catalogue("legacy").filter((row) => row.is_active !== false).map((row) => toCatalogExercise(row as unknown as CatalogRow));

  test("estimates come from the older columns", () => {
    const squat = exercises.find((exercise) => exercise.id === "free-exercise-db-Barbell_Squat")!;
    assert.deepEqual([squat.curated, squat.required_equipment, squat.locations], [false, ["barbell"], ["gym"]]);
  });

  test("every word must be found in the name, in any order (smart search)", () => {
    assert.deepEqual(names(filterCatalog(exercises, params({ q: "press bench" }))), ["Barbell Bench Press", "Dumbbell Bench Press"]);
    assert.deepEqual(names(filterCatalog(exercises, params({ q: "a_b" }))), ["Row Variation A_B"]);
    assert.deepEqual(names(filterCatalog(exercises, params({ q: "benchpress" }))), ["Barbell Bench Press", "Dumbbell Bench Press"]);
    assert.deepEqual(names(filterCatalog(exercises, params({ q: "pushups" }))), ["Push-Up"]);
  });

  test("Home context and doable equipment", () => {
    const owned = ["dumbbell", "bench", "chair", "box"];
    assert.deepEqual(names(sortCatalog(filterCatalog(exercises, params({ location: "home", doable: owned })), "name")), ["Dumbbell Bench Press", "Hamstring Stretch", "Pullups", "Push-Up"]);
    assert.deepEqual(names(sortCatalog(filterCatalog(exercises, params({ doable: [] })), "name")), ["Hamstring Stretch", "Pullups", "Push-Up"]);
  });

  test("muscle group, category, equipment, difficulty and ids", () => {
    assert.deepEqual(names(filterCatalog(exercises, params({ muscleGroups: ["back"] }))), ["Pullups", "Row Variation A_B", "Row Variation AXB"]);
    assert.deepEqual(names(filterCatalog(exercises, params({ muscleGroups: ["back", "chest"], primary: ["hamstrings"] }))).length, 7, "groups and regions: any of them");
    assert.deepEqual(names(filterCatalog(exercises, params({ categories: ["stretching"] }))), ["Hamstring Stretch"]);
    assert.deepEqual(names(filterCatalog(exercises, params({ equipment: ["cable_machine"], difficulties: ["beginner"] }))), ["Row Variation A_B", "Row Variation AXB"]);
    assert.deepEqual(names(filterCatalog(exercises, params({ equipment: ["none"] }))), ["Push-Up", "Pullups", "Hamstring Stretch"]);
    assert.deepEqual(names(filterCatalog(exercises, params({ ids: ["push_up", "missing"] }))), ["Push-Up"]);
  });

  test("sorting by difficulty puts beginner first, then name", () => {
    const sorted = sortCatalog(exercises, "difficulty").map((exercise) => exercise.difficulty);
    assert.deepEqual(sorted, [...sorted].sort((a, b) => ["beginner", "intermediate", "advanced"].indexOf(a) - ["beginner", "intermediate", "advanced"].indexOf(b)));
    assert.equal(sortCatalog(exercises, "difficulty").at(-1)?.name, "Barbell Squat");
  });

  test("pages are 1-based; a page past the end is empty", () => {
    assert.deepEqual(pageRange(1, 24), { from: 0, to: 23 });
    assert.deepEqual(pageRange(3, 10), { from: 20, to: 29 });
    assert.deepEqual(paginate([1, 2, 3, 4, 5], 2, 2), { items: [3, 4], total: 5 });
    assert.deepEqual(paginate([1, 2, 3], 9, 2), { items: [], total: 3 });
  });
});

describe("difficultyWindows", () => {
  const counts = [{ level: "advanced" as const, count: 1 }, { level: "beginner" as const, count: 5 }, { level: "intermediate" as const, count: 2 }];
  test("a page that spans levels reads from each in order", () => {
    assert.deepEqual(difficultyWindows(counts, 4, 7), [
      { level: "beginner", from: 4, to: 4 },
      { level: "intermediate", from: 0, to: 1 },
      { level: "advanced", from: 0, to: 0 },
    ]);
    assert.deepEqual(difficultyWindows(counts, 0, 2), [{ level: "beginner", from: 0, to: 2 }]);
  });
  test("empty levels and pages past the end read nothing", () => {
    assert.deepEqual(difficultyWindows([{ level: "beginner", count: 0 }, { level: "intermediate", count: 3 }, { level: "advanced", count: 0 }], 0, 23), [{ level: "intermediate", from: 0, to: 2 }]);
    assert.deepEqual(difficultyWindows(counts, 8, 31), []);
  });
});

describe("library URL state", () => {
  test("Browse by muscle keeps the library's place and ?have= list, nothing else", () => {
    assert.equal(browseByMuscleHref(DEFAULT_LIBRARY_STATE), "/exercises/muscles");
    const home = readLibraryState("context=home&focus=chest&q=press");
    assert.equal(browseByMuscleHref(home), "/exercises/muscles?context=home");
    const have = readLibraryState("have=dumbbell,bench&doable=1");
    const href = browseByMuscleHref(have);
    assert.equal(href, `/exercises/muscles?${writeLibraryState({ ...DEFAULT_LIBRARY_STATE, have: have.have })}`);
    assert.ok(href.startsWith("/exercises/muscles?have=") && !href.includes("doable"));
    const back = readLibraryState(href.split("?")[1]);
    assert.deepEqual([back.context, back.have], ["gym", have.have], "the muscles page reads them back");
    assert.equal(readLibraryState(browseByMuscleHref(readLibraryState("have=none")).split("?")[1]).have?.length, 0, "no equipment stays no equipment");
  });

  test("reads the page's own keys, lists included", () => {
    assert.deepEqual(readLibraryState("?q=row&context=home&doable=1&focus=chest,arms&muscle=lats,back&uses=dumbbell,none,machines&have=dumbbell,bench&difficulty=advanced,beginner&category=strength&movement=pull&mechanic=compound&saved=1&sort=difficulty"), {
      q: "row", context: "home", doable: true, focus: ["chest", "arms"], muscles: ["lats", "back"], uses: ["dumbbell", "none", "machines"], have: ["dumbbell", "bench"],
      difficulties: ["beginner", "advanced"], categories: ["strength"], movements: ["pull"], mechanics: ["compound"], saved: true, sort: "difficulty",
    });
    assert.deepEqual(readLibraryState(""), DEFAULT_LIBRARY_STATE);
    assert.equal(DEFAULT_LIBRARY_STATE.sort, "best");
  });

  test("links from earlier versions keep working (single values included)", () => {
    const state = readLibraryState("location=home&muscle=lats&equipment=bands&movement=push");
    assert.deepEqual([state.context, state.muscles, state.uses, state.movements], ["home", ["lats"], ["resistance_band"], ["push"]]);
    assert.deepEqual(readLibraryState("muscle=chest").muscles, ["chest"]);
    assert.deepEqual(readLibraryState("equipment=dumbbell").uses, ["dumbbell"]);
    assert.deepEqual(readLibraryState("equipment=body%20only").uses, ["none"], "body weight is a filter now");
    assert.deepEqual(readLibraryState("muscle=upper_back").muscles, ["middle_back"]);
    assert.deepEqual(readLibraryState("muscle=full_body").focus, ["full_body"], "Full body is the focus area, not a one-exercise group");
    assert.deepEqual(readLibraryState("muscle=full_body").muscles, []);
    assert.equal(readLibraryState("context=gym&location=home").context, "gym");
    assert.deepEqual(readLibraryState("focus=Lower%20body,belly").focus, ["abs", "legs"]);
    assert.equal(canonicalLibrarySearch("location=home&equipment=dumbbell&muscle=back"), "context=home&muscle=back&uses=dumbbell");
    assert.equal(canonicalLibrarySearch("muscle=full_body"), "focus=full_body");
  });

  test("have=: none means no equipment, unknown items are ignored", () => {
    assert.deepEqual(readLibraryState("have=none").have, []);
    assert.deepEqual(readLibraryState("have=").have, []);
    assert.deepEqual(readLibraryState("have=bodyweight").have, []);
    assert.deepEqual(readLibraryState("have=bench,dumbbells").have, ["dumbbell", "bench"]);
    assert.equal(readLibraryState("have=jetpack").have, null);
    assert.equal(readLibraryState("").have, null);
    assert.equal(writeLibraryState({ ...DEFAULT_LIBRARY_STATE, have: [] }), "have=none");
  });

  test("writes drop defaults, keep a fixed order and round-trip", () => {
    assert.equal(withLibraryParam("location=home&q=row", "context", "gym"), "q=row");
    assert.equal(withLibraryParam("", "context", "home"), "context=home");
    assert.equal(withLibraryParam("doable=1", "doable", false), "");
    assert.equal(withLibraryParam("", "sort", "best"), "");
    assert.equal(withLibraryParam("", "sort", "name"), "sort=name");
    assert.equal(withLibraryParam("q=row", "q", "  "), "");
    assert.equal(withoutLibraryFilters("context=home&q=row&doable=1&muscle=back&movement=push&location=home"), "context=home");
    const state = readLibraryState("sort=name&saved=1&mechanic=isolation&movement=hold&category=cardio&difficulty=intermediate&doable=1&have=box&uses=sled&muscle=neck&focus=glutes&context=home&q=x");
    assert.equal(writeLibraryState(state), "q=x&context=home&focus=glutes&muscle=neck&uses=sled&have=box&doable=1&difficulty=intermediate&category=cardio&movement=hold&mechanic=isolation&saved=1&sort=name");
    assert.deepEqual(readLibraryState(writeLibraryState(state)), state);
  });

  test("chips: one per filter, each removable on its own; Clear all keeps the search and the context", () => {
    const state = readLibraryState("q=press&context=home&focus=chest,arms&uses=barbell&have=dumbbell&doable=1&difficulty=beginner&saved=1");
    const chips = filterChips(state);
    assert.deepEqual(chips.map((chip) => `${chip.kind}: ${chip.label}`), ["Train: Chest", "Train: Arms", "Uses: Barbell and plates", "You have: Dumbbells", "Show: Only what I can do", "Level: Beginner", "Show: Saved"]);
    assert.equal(activeFilterCount(state), 7);
    assert.equal(panelFilterCount(state), 2);
    for (const chip of chips) {
      const after = filterChips(withoutChip(state, chip));
      assert.equal(after.length, chips.length - 1, `${chip.label} removes only itself`);
    }
    assert.deepEqual(withoutChip(state, { key: "have", value: "" }).have, null, "removing the equipment chip goes back to the saved list");
    const cleared = withoutFilters(state);
    assert.deepEqual([cleared.q, cleared.context, filterChips(cleared).length], ["press", "home", 0]);
  });

  test("the engine query for a state: home is the environment, Saved limits to the saved ids", () => {
    const query = libraryQuery(readLibraryState("q=curl&context=home&focus=arms&uses=dumbbell&doable=1&saved=1"), ["biceps_curl"]);
    assert.deepEqual(query, {
      q: "curl", focus: ["arms"], muscles: [], categories: [], difficulties: [], uses: ["dumbbell"], movements: [], mechanics: [], environment: "home",
      ids: ["biceps_curl"], doableOnly: true, sort: "best",
    });
    assert.equal(libraryQuery(DEFAULT_LIBRARY_STATE, ["x"]).ids, null);
  });

  test("a muscle word in the search becomes a filter on request", () => {
    const pecs = muscleWordFilter(readLibraryState("q=pecs"));
    assert.deepEqual(pecs && { word: pecs.word, label: pecs.label, q: pecs.next.q, focus: pecs.next.focus }, { word: "pec", label: "Chest", q: "", focus: ["chest"] });
    const lats = muscleWordFilter(readLibraryState("q=lats%20pulldown"));
    assert.equal(lats, null, "lat pulldown is an exercise name, not a muscle");
    const quads = muscleWordFilter(readLibraryState("q=quads%20squat"));
    assert.deepEqual(quads && { q: quads.next.q, muscles: quads.next.muscles }, { q: "squat", muscles: ["quadriceps"] });
    assert.equal(muscleWordFilter(readLibraryState("q=pecs&focus=chest")), null, "already filtered");
    assert.equal(muscleWordFilter(readLibraryState("q=bench")), null);
  });

  test("relax labels and states name what changes", () => {
    const state = readLibraryState("q=row&uses=barbell,kettlebell&difficulty=advanced&context=home&doable=1&saved=1");
    assert.equal(relaxLabel("uses", state), "Remove Barbell and plates and Kettlebell");
    assert.equal(relaxLabel("difficulties", state), "Remove Advanced");
    assert.equal(relaxLabel("q", state), "Clear the search");
    assert.deepEqual(relaxState("uses", state).uses, []);
    assert.deepEqual([relaxState("environment", state).context, relaxState("ids", state).saved, relaxState("doableOnly", state).doable], ["gym", false, false]);
  });
});

// ---------------------------------------------------------------- against a PostgREST stand-in

const BASE_COLUMNS = ["id", "name", "description", "primary_muscle", "secondary_muscles", "equipment", "locations", "difficulty", "movement_pattern", "instructions", "recommended_sets", "reps_min", "reps_max", "rest_seconds", "alternatives", "attribution", "is_active"];
const V2_COLUMNS = ["category", "mechanic", "muscle_group", "required_equipment", "prescription_type", "default_duration_seconds", "source_ref", "merged_into", "catalog_version"];
const MEDIA_COLUMNS = ["id", "exercise_id", "kind", "position", "storage_path", "source_url", "mirrored_at", "width", "height", "alt", "attribution", "license"];
const RESERVED = new Set(["select", "order", "offset", "limit"]);
const LEGACY_SELECT = "id,name,primary_muscle,secondary_muscles,equipment,locations,difficulty,movement_pattern,recommended_sets,reps_min,reps_max,rest_seconds,alternatives";

function likeExpression(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") source += (pattern[++index] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (char === "%" || char === "*") source += ".*";
    else if (char === "_") source += ".";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "is");
}

const arrayLiteral = (value: string) => value.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
const listLiteral = (value: string) => value.replace(/^\(|\)$/g, "").split(",").map((item) => item.replace(/^"|"$/g, "")).filter(Boolean);

function matchesFilter(value: unknown, filter: string): boolean {
  const dot = filter.indexOf(".");
  const operator = filter.slice(0, dot);
  const operand = filter.slice(dot + 1);
  if (operator === "eq") return String(value) === operand;
  if (operator === "gte") return Number(value) >= Number(operand);
  if (operator === "ilike") return likeExpression(operand).test(String(value ?? ""));
  if (operator === "cs") return arrayLiteral(operand).every((item) => ((value as string[]) ?? []).includes(item));
  if (operator === "cd") { const allowed = new Set(arrayLiteral(operand)); return ((value as string[]) ?? []).every((item) => allowed.has(item)); }
  if (operator === "ov") return arrayLiteral(operand).some((item) => ((value as string[]) ?? []).includes(item));
  if (operator === "in") return listLiteral(operand).includes(String(value));
  throw new Error(`stand-in PostgREST: unsupported operator ${operator}`);
}

/** Just enough of PostgREST and Supabase Auth for these queries, on 127.0.0.1. */
class FakePostgrest {
  server!: Server;
  url = "";
  exercises: Row[] = [];
  /** null: the exercise_media table does not exist yet. */
  media: Row[] | null = null;
  v2 = false;
  failLibrary = false;
  requests: Array<{ method: string; table: string; query: URLSearchParams }> = [];
  tokens = new Map<string, string>();

  async start() {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop() {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  use(state: CatalogueState, media: Row[] | null = null) {
    this.exercises = catalogue(state);
    this.v2 = state !== "legacy";
    this.media = media;
    this.failLibrary = false;
    this.requests = [];
  }

  libraryRequests() {
    return this.requests.filter((request) => request.table === "exercise_library");
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", this.url);
    const head = req.method === "HEAD";
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(body === undefined || head ? "" : JSON.stringify(body));
    };
    if (url.pathname === "/auth/v1/user") {
      const userId = this.tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      return userId ? send(200, { id: userId, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} }) : send(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
    }
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    this.requests.push({ method: req.method ?? "GET", table, query: url.searchParams });
    if (table === "exercise_library") {
      // 500, not 503: supabase-js retries 503 and 520 with backoff, which only slows the test down.
      if (this.failLibrary) return send(500, { code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" });
      return this.query(table, this.exercises, this.v2 ? [...BASE_COLUMNS, ...V2_COLUMNS] : BASE_COLUMNS, url, req, send);
    }
    if (table === "exercise_media") {
      if (!this.media) return send(404, { code: "PGRST205", details: null, hint: null, message: "Could not find the table 'public.exercise_media' in the schema cache" });
      return this.query(table, this.media, MEDIA_COLUMNS, url, req, send);
    }
    return send(404, { message: `stand-in PostgREST: no route for ${url.pathname}` });
  }

  private query(table: string, rows: Row[], columns: string[], url: URL, req: IncomingMessage, send: (status: number, body?: unknown, headers?: Record<string, string>) => void) {
    const query = url.searchParams;
    const select = (query.get("select") ?? "*").split(",").map((column) => column.trim()).filter(Boolean);
    const unknown = [...select.filter((column) => column !== "*"), ...[...query.keys()].filter((key) => !RESERVED.has(key))].find((column) => !columns.includes(column));
    if (unknown) return send(400, { code: "42703", details: null, hint: null, message: `column ${table}.${unknown} does not exist` });
    const matching = rows.filter((row) => [...query.entries()].every(([key, value]) => RESERVED.has(key) || matchesFilter(row[key], value)));
    const order = query.get("order");
    if (order) {
      const [column, direction] = order.split(".");
      const sign = direction === "desc" ? -1 : 1;
      matching.sort((a, b) => {
        const left = a[column] as string | number;
        const right = b[column] as string | number;
        return (left < right ? -1 : left > right ? 1 : 0) * sign;
      });
    }
    const counting = /count=exact/.test(String(req.headers.prefer ?? ""));
    const offset = Number(query.get("offset") ?? 0);
    const limit = query.has("limit") ? Number(query.get("limit")) : Number.POSITIVE_INFINITY;
    if (counting && offset > matching.length) {
      return send(416, { code: "PGRST103", details: `An offset of ${offset} was requested, but there are only ${matching.length} rows.`, hint: null, message: "Requested range not satisfiable" });
    }
    const page = matching.slice(offset, offset + limit);
    const range = page.length ? `${offset}-${offset + page.length - 1}` : "*";
    const body = page.map((row) => (select.includes("*") ? row : Object.fromEntries(select.map((column) => [column, row[column] ?? null]))));
    return send(200, body, { "content-range": `${range}/${counting ? matching.length : "*"}` });
  }
}

const MEDIA_ROWS: Row[] = [
  { id: "m1", exercise_id: "bench_press", kind: "still", position: 1, storage_path: "fitx/bench_press/1.jpg", source_url: "https://example.org/bench-1.jpg", mirrored_at: null, alt: "Barbell Bench Press, photo 2 of 2", attribution: "FITX", license: "All rights reserved" },
  { id: "m0", exercise_id: "bench_press", kind: "still", position: 0, storage_path: "fitx/bench_press/0.jpg", source_url: "https://example.org/bench-0.jpg", mirrored_at: "2026-11-18T10:00:00Z", alt: "Barbell Bench Press, photo 1 of 2", attribution: "FITX", license: "All rights reserved" },
  { id: "m2", exercise_id: "free-exercise-db-Pullups", kind: "still", position: 0, storage_path: "free-exercise-db/Pullups/0.jpg", source_url: `${PINNED_PHOTO_BASE}Pullups/0.jpg`, mirrored_at: null, alt: "Pullups, photo 1 of 2", attribution: "Free Exercise DB (github.com/yuhonas/free-exercise-db)", license: "Unlicense (public domain dedication)" },
];

describe("searchCatalog and thumbnails against PostgREST", () => {
  const fake = new FakePostgrest();
  let db: Parameters<typeof searchCatalog>[0];

  before(async () => {
    await fake.start();
    const { createClient } = await import("@supabase/supabase-js");
    db = createClient(fake.url, "test-anon-key", { auth: { persistSession: false, autoRefreshToken: false } });
  });
  after(() => fake.stop());

  test("before the catalogue migration: estimated filters in memory, curated false", async () => {
    fake.use("legacy");
    const outcome = await searchCatalog(db, params({ location: "home", doable: ["dumbbell", "bench", "chair", "box"] }));
    assert.equal(outcome.error, null);
    assert.equal(outcome.curated, false);
    assert.deepEqual(names(outcome.exercises), ["Dumbbell Bench Press", "Hamstring Stretch", "Pullups", "Push-Up"]);
    assert.equal(outcome.total, 4);
    assert.ok(outcome.exercises.every((exercise) => !exercise.curated));
    // The v2 columns were asked for (and refused); the estimated search reads only the older ones.
    const legacyRead = fake.libraryRequests().find((request) => request.query.get("select") === LEGACY_SELECT);
    assert.ok(legacyRead);
    assert.deepEqual(legacyRead.query.getAll("is_active"), ["eq.true"]);
    assert.equal(legacyRead.query.has("locations") || legacyRead.query.has("required_equipment"), false);
  });

  test("before the migration: the search runs in memory, exact filters in Postgres, inactive rows never appear", async () => {
    fake.use("legacy");
    const outcome = await searchCatalog(db, params({ q: "bench", difficulties: ["beginner", "intermediate"], pageSize: 1, page: 2 }));
    assert.deepEqual([outcome.total, names(outcome.exercises)], [2, ["Dumbbell Bench Press"]]);
    const legacyRead = fake.libraryRequests().find((request) => request.query.get("select") === LEGACY_SELECT);
    assert.deepEqual(legacyRead?.query.getAll("name"), [], "names are matched by the smart search, not a pattern");
    assert.deepEqual(legacyRead?.query.getAll("difficulty"), ["in.(beginner,intermediate)"]);
    assert.deepEqual([legacyRead?.query.get("offset"), legacyRead?.query.get("limit")], ["0", "1000"]);
  });

  test("columns added but not filled yet: still the estimated search", async () => {
    fake.use("uncurated");
    const outcome = await searchCatalog(db, params({ muscleGroups: ["chest"] }));
    assert.equal(outcome.curated, false);
    assert.deepEqual(names(outcome.exercises), ["Barbell Bench Press", "Dumbbell Bench Press", "Push-Up"]);
  });

  test("curated: a name search reads the active rows and matches in memory", async () => {
    fake.use("curated");
    const outcome = await searchCatalog(db, params({ q: "a_b" }));
    assert.equal(outcome.curated, true);
    assert.deepEqual(names(outcome.exercises), ["Row Variation A_B"]);
    const read = fake.libraryRequests().find((request) => request.query.get("select")?.includes("catalog_version") && request.query.has("offset"));
    assert.deepEqual(read?.query.getAll("name"), []);
    assert.deepEqual(read?.query.getAll("is_active"), ["eq.true"]);
    assert.equal(read?.query.get("order"), "name.asc");
    assert.deepEqual(names((await searchCatalog(db, params({ q: "bp" }))).exercises), ["Barbell Bench Press", "Dumbbell Bench Press"], "gym terms work through the API");
  });

  test("curated: Home context and doable equipment use the cleaned-up values", async () => {
    fake.use("curated");
    const outcome = await searchCatalog(db, params({ location: "home", doable: ["dumbbell", "bench", "chair", "box"] }));
    // Pull-ups now need a pull-up bar; the uncurated row_axb is left out of equipment filters.
    assert.deepEqual(names(outcome.exercises), ["Dumbbell Bench Press", "Hamstring Stretch", "Push-Up"]);
    const read = fake.libraryRequests().find((request) => request.query.has("offset"));
    assert.deepEqual(read?.query.getAll("locations"), ["cs.{home}"]);
    assert.deepEqual(read?.query.getAll("required_equipment"), ["cd.{dumbbell,bench,chair,box}"]);
    assert.deepEqual(read?.query.getAll("catalog_version"), ["gte.1"]);

    const none = await searchCatalog(db, params({ doable: [] }));
    assert.deepEqual(names(none.exercises), ["Hamstring Stretch", "Push-Up"]);
    const equipment = await searchCatalog(db, params({ equipment: ["barbell"], muscleGroups: ["quadriceps"], categories: ["strength"], difficulties: ["advanced"] }));
    assert.deepEqual(names(equipment.exercises), ["Barbell Squat"]);
    const listRead = fake.libraryRequests().filter((request) => request.query.has("offset")).at(-1);
    assert.deepEqual([listRead?.query.getAll("required_equipment"), listRead?.query.getAll("muscle_group"), listRead?.query.getAll("difficulty")], [["ov.{barbell}"], ["in.(quadriceps)"], ["eq.advanced"]]);
    const several = await searchCatalog(db, params({ equipment: ["barbell", "cable_machine"], muscleGroups: ["back", "quadriceps"] }));
    assert.deepEqual(names(several.exercises), ["Barbell Squat", "Row Variation A_B"], "any of the values, within each kind");
  });

  test("curated: body weight, focus and best match rank in memory", async () => {
    fake.use("curated");
    const bodyweight = await searchCatalog(db, params({ equipment: ["none"] }));
    assert.deepEqual(names(bodyweight.exercises), ["Hamstring Stretch", "Push-Up"]);
    const chest = await searchCatalog(db, params({ focus: ["chest"], doable: ["dumbbell", "bench"], sort: "best" }));
    assert.deepEqual(names(chest.exercises), ["Dumbbell Bench Press", "Push-Up"], "only doable ones with doable= (staples first)");
    const pulls = await searchCatalog(db, params({ movements: ["pull"] }));
    assert.deepEqual(names(pulls.exercises), ["Pullups", "Row Variation A_B"]);
  });

  test("curated: muscle_group=full_body follows the full-body rule whatever the sort", async () => {
    fake.use("curated");
    const byName = await searchCatalog(db, params({ muscleGroups: ["full_body"], sort: "name" }));
    assert.ok(!fake.libraryRequests().some((request) => request.query.has("muscle_group")), "never the one-value column in Postgres");
    const best = await searchCatalog(db, params({ muscleGroups: ["full_body"], sort: "best" }));
    const easiest = await searchCatalog(db, params({ muscleGroups: ["full_body"], sort: "difficulty" }));
    assert.deepEqual([byName.total, easiest.total], [best.total, best.total]);
    assert.deepEqual(names(byName.exercises).sort(), names(best.exercises).sort());
    assert.deepEqual(names(easiest.exercises).sort(), names(best.exercises).sort());
  });

  test("curated: rows the clean-up has not reached still show without filters, marked uncurated", async () => {
    fake.use("curated");
    const outcome = await searchCatalog(db, params({ q: "row variation" }));
    assert.deepEqual(outcome.exercises.map((exercise) => [exercise.name, exercise.curated]).sort(), [["Row Variation AXB", false], ["Row Variation A_B", true]].sort());
    const filtered = await searchCatalog(db, params({ q: "row variation", muscleGroups: ["back"] }));
    assert.deepEqual(names(filtered.exercises), ["Row Variation A_B"], "but not in filters that read the clean-up's values");
  });

  test("curated: sorting by difficulty pages across levels", async () => {
    fake.use("curated");
    const first = await searchCatalog(db, params({ sort: "difficulty", pageSize: 4 }));
    const second = await searchCatalog(db, params({ sort: "difficulty", pageSize: 4, page: 2 }));
    assert.equal(first.total, 8);
    assert.deepEqual(names(first.exercises), ["Dumbbell Bench Press", "Hamstring Stretch", "Push-Up", "Row Variation AXB"]);
    assert.deepEqual(names(second.exercises), ["Row Variation A_B", "Barbell Bench Press", "Pullups", "Barbell Squat"]);
    assert.equal(second.total, 8);
  });

  test("curated: a page past the end is empty with the right total", async () => {
    fake.use("curated");
    const outcome = await searchCatalog(db, params({ page: 5, pageSize: 48 }));
    assert.deepEqual([outcome.error, outcome.exercises, outcome.total], [null, [], 8]);
  });

  test("ids limit the results to saved exercises", async () => {
    fake.use("curated");
    const outcome = await searchCatalog(db, params({ ids: ["push_up", "free-exercise-db-Pullups", "old_bench_press", "nope"] }));
    assert.deepEqual(names(outcome.exercises), ["Pullups", "Push-Up"]);
  });

  test("database failures are returned, not hidden", async () => {
    fake.use("curated");
    fake.failLibrary = true;
    const outcome = await searchCatalog(db, params());
    assert.deepEqual([outcome.exercises, outcome.total, (outcome.error as { code?: string }).code], [[], 0, "57014"]);
  });

  test("thumbnails: the pinned photos while the media table is missing", async () => {
    fake.use("legacy", null);
    const exercises = (await searchCatalog(db, params({ ids: ["bench_press", "free-exercise-db-Pullups"] }))).exercises;
    const { error, thumbnails } = await loadCatalogThumbnails(db, exercises, fake.url);
    assert.equal(error, null);
    assert.deepEqual(Object.fromEntries(thumbnails), {
      bench_press: null,
      "free-exercise-db-Pullups": `${PINNED_PHOTO_BASE}Pullups/0.jpg`,
    });
  });

  test("thumbnails: mirrored copies first, then the source, then the pinned photo from source_ref", async () => {
    fake.use("curated", MEDIA_ROWS);
    const exercises = (await searchCatalog(db, params({ ids: ["bench_press", "free-exercise-db-Pullups", "push_up", "free-exercise-db-Hamstring_Stretch"] }))).exercises;
    const { error, thumbnails } = await loadCatalogThumbnails(db, exercises, fake.url);
    assert.equal(error, null);
    assert.deepEqual(Object.fromEntries(thumbnails), {
      bench_press: `${fake.url}/storage/v1/object/public/exercise-media/fitx/bench_press/0.jpg`,
      "free-exercise-db-Hamstring_Stretch": `${PINNED_PHOTO_BASE}Hamstring_Stretch/0.jpg`,
      "free-exercise-db-Pullups": `${PINNED_PHOTO_BASE}Pullups/0.jpg`,
      push_up: `${PINNED_PHOTO_BASE}Pushups/0.jpg`,
    });
    const mediaRead = fake.requests.find((request) => request.table === "exercise_media");
    assert.deepEqual(mediaRead?.query.getAll("kind"), ["eq.still"]);
    assert.equal((await loadCatalogThumbnails(db, [], fake.url)).thumbnails.size, 0);
  });
});

// ---------------------------------------------------------------- the route handler

describe("GET /api/exercises", () => {
  const fake = new FakePostgrest();
  const USER = "33333333-3333-4333-8333-333333333333";
  let GET: (request: import("next/server").NextRequest) => Promise<Response>;
  let NextRequest: typeof import("next/server").NextRequest;
  let session = "";

  before(async () => {
    await fake.start();
    process.env.NEXT_PUBLIC_SUPABASE_URL = fake.url;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    ({ NextRequest } = await import("next/server"));
    ({ GET } = await import("@/app/api/exercises/route"));
    const accessToken = makeJwt(USER, 3600);
    fake.tokens.set(accessToken, USER);
    session = ssrCookieValue({
      access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "refresh-test",
      user: { id: USER, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    });
  });
  after(() => fake.stop());
  beforeEach(() => fake.use("curated", MEDIA_ROWS));

  const call = (query: string, signedIn = true) => GET(new NextRequest(new URL(`/api/exercises${query}`, "https://fitnessx.vercel.app"), {
    headers: { host: "fitnessx.vercel.app", "x-forwarded-proto": "https", ...(signedIn ? { cookie: `${SESSION_COOKIE}=${session}` } : {}) },
  }));

  test("signed-out callers get 401 and nothing is read", async () => {
    const response = await call("?q=press", false);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(fake.libraryRequests().length, 0);
  });

  test("a page of light exercises with thumbnails, cached privately", async () => {
    const response = await call("?muscle_group=chest&pageSize=2&unknown=1&page=1");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, max-age=60");
    const body = await response.json() as { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; curated: boolean };
    assert.deepEqual([body.total, body.page, body.pageSize, body.curated], [3, 1, 2, true]);
    assert.deepEqual(body.items.map((item) => item.name), ["Barbell Bench Press", "Dumbbell Bench Press"]);
    assert.equal(body.items[0].thumbnail, `${fake.url}/storage/v1/object/public/exercise-media/fitx/bench_press/0.jpg`);
    assert.equal(body.items[1].thumbnail, null);
    assert.ok(!("instructions" in body.items[0]) && !("description" in body.items[0]));
    assert.deepEqual(body.items[0].required_equipment, ["barbell", "bench"]);
  });

  test("the smart search and the new filters work through the route", async () => {
    const response = await call("?q=bp&equipment=barbell,cable_machine&sort=best");
    const body = await response.json() as { items: Array<{ name: string }>; total: number };
    assert.deepEqual([response.status, body.items.map((item) => item.name), body.total], [200, ["Barbell Bench Press"], 1]);
    const focus = await call("?focus=chest&doable=&sort=best");
    assert.deepEqual(((await focus.json()) as { items: Array<{ name: string }> }).items.map((item) => item.name), ["Push-Up"], "chest you can do with nothing");
  });

  test("bad numbers are clamped instead of failing", async () => {
    const response = await call("?page=-2&pageSize=9999&sort=sideways");
    const body = await response.json() as { page: number; pageSize: number; total: number };
    assert.deepEqual([response.status, body.page, body.pageSize, body.total], [200, 1, MAX_PAGE_SIZE, 8]);
  });

  test("before the migrations it answers with estimates and curated false", async () => {
    fake.use("legacy", null);
    const response = await call("?location=home&doable=");
    const body = await response.json() as { items: Array<{ name: string; thumbnail: string | null }>; curated: boolean };
    assert.equal(body.curated, false);
    assert.deepEqual(body.items.map((item) => [item.name, item.thumbnail]), [
      ["Hamstring Stretch", `${PINNED_PHOTO_BASE}Hamstring_Stretch/0.jpg`],
      ["Pullups", `${PINNED_PHOTO_BASE}Pullups/0.jpg`],
      ["Push-Up", null],
    ]);
  });

  test("a database failure is a 502 that is not cached, logged by code only", async () => {
    fake.failLibrary = true;
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      const response = await call("");
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match((await response.json() as { error: string }).error, /could not be loaded/);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(warnings, [["FITX exercise search failed", "57014"]]);
  });
});
