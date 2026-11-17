import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError, isMissingTableError } from "@/lib/domain/schema-fallback";
import { BODY_REGIONS, exerciseRegions, isRegionKey, regionsForMuscle, type RegionKey } from "./anatomy";
import { CATALOG_BASE_COLUMNS, CATALOG_V2_COLUMNS, toCatalogExercise, type CatalogExercise, type CatalogRow } from "./catalog";
import { missingEquipment } from "./equipment";
import { FOCUS_AREAS, focusRole, isFullBodyExercise, parseFocusParam, type FocusArea } from "./focus";
import { EXERCISE_MEDIA_COLUMNS, groupMediaRows, resolveExerciseMedia, type ExerciseMediaRow } from "./media";
import { matchExercise, parseSearch, relevanceBand, type SearchMatch, type SearchPlan } from "./search-terms";
import { stapleRank } from "./staples";
import {
  EQUIPMENT_KEYS,
  EXERCISE_CATEGORIES,
  LEVELS,
  levelRank,
  MECHANICS,
  MUSCLE_GROUPS,
  muscleGroupOf,
  TRAINING_CONTEXTS,
  type ExerciseCategory,
  type Level,
  type Mechanic,
  type MuscleGroup,
  type TrainingContext,
} from "./taxonomy";

/**
 * Exercise library search, shared by the library page (in memory, over the light catalogue it loads once) and
 * GET /api/exercises (paged): the filters, the smart name search (./search-terms.ts), the ranking, and the API's
 * query parameters and database queries.
 *
 * Filters combine with AND across kinds and OR within a kind ("Chest or Arms", "uses a barbell or a cable"):
 *  - focus areas (focus.ts): an exercise matches when it trains an area as its main or an assisting muscle;
 *  - muscles: training-level groups (muscle_group) or body-map regions (the primary muscle);
 *  - category, difficulty, mechanic, movement (push, pull, hold, from movement_pattern where the catalogue
 *    records one), equipment it uses ("none" = needs nothing, "machines" = any machine);
 *  - the training place: at home, exercises whose equipment is home-friendly or that the member can do;
 *  - what the member has (`owned`): "doable" when every required item is in it (expandOwnedEquipment).
 * "Best match" ranks by the search score, then focus (main muscle before assisting), training exercises before
 * stretches, then what the member can do, then FITX staples, then level, compound before isolation, then name.
 *
 * The API works in two database states:
 *  - curated (some active row has catalog_version >= 1): plain filtered lists run in Postgres and pages come
 *    from `range()` with an exact count; searches, focus, "best match" and "needs nothing" rank in memory over the
 *    active rows;
 *  - not curated (the v2 columns are missing, or present but not filled yet): the light legacy rows are read,
 *    estimated with toCatalogExercise, then filtered, ranked and paged here. The response says `curated: false`.
 *
 * No Next.js imports, so `node --test` can load it.
 */

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 48;
export const MAX_PAGE = 500;
export const MAX_QUERY_LENGTH = 80;
export const MAX_SEARCH_WORDS = 6;
export const MAX_IDS = 100;
/** Keeps the ids (and the PostgREST URL built from them) well inside common 8 KB request-line limits. */
export const MAX_IDS_LENGTH = 4000;

export type CatalogSort = "name" | "difficulty" | "best";

// ---------------------------------------------------------------- vocabularies of the filters

/** Movement categories, from the catalogue's movement_pattern (Free Exercise DB force values and starter patterns). */
export const MOVEMENTS = ["push", "pull", "hold"] as const;
export type Movement = (typeof MOVEMENTS)[number];
export const MOVEMENT_LABELS: Readonly<Record<Movement, string>> = { push: "Push", pull: "Pull", hold: "Hold" };

/**
 * The movement_pattern values of each movement. The starter patterns follow the force their Free Exercise DB
 * twins record (a squat, hip thrust or calf raise pushes; a hinge or curl pulls; a plank holds). Patterns such as
 * cardio, plyometrics or strongman have no movement, so the filter leaves those exercises out.
 */
export const MOVEMENT_PATTERNS: Readonly<Record<Movement, readonly string[]>> = {
  push: ["push", "horizontal_push", "vertical_push", "squat", "single_leg_squat", "hip_extension", "elbow_extension", "shoulder_abduction", "horizontal_adduction", "plantar_flexion", "locomotion"],
  pull: ["pull", "horizontal_pull", "vertical_pull", "hinge", "elbow_flexion"],
  hold: ["static", "anti_extension"],
};

const PATTERN_MOVEMENT = new Map<string, Movement>(MOVEMENTS.flatMap((movement) => MOVEMENT_PATTERNS[movement].map((pattern) => [pattern, movement] as const)));

/** The movement of a catalogue movement_pattern, or null when the catalogue records none. */
export function movementOf(pattern: string | null | undefined): Movement | null {
  return PATTERN_MOVEMENT.get((pattern ?? "").trim().toLowerCase()) ?? null;
}

/** Equipment filter values beyond the keys: "none" (needs no equipment) and "machines" (any machine). */
export const NO_EQUIPMENT = "none";
export const MACHINES = "machines";
/** The machines umbrella (cable machines stay separate). */
export const MACHINE_KEYS: readonly string[] = ["machine", "smith_machine", "cardio_machine"];
export const USES_VALUES: readonly string[] = [NO_EQUIPMENT, MACHINES, ...EQUIPMENT_KEYS];

const MUSCLE_GROUP_SET: ReadonlySet<string> = new Set(MUSCLE_GROUPS);

/**
 * Muscle filter values, kept: group keys (back, core, hips…), region keys (lats, abdominals…) and older words read
 * as their region ("upper_back" → middle_back) or group. Unknown words are dropped; order kept, no repeats.
 */
export function normaliseMuscleValues(values: Iterable<string>): string[] {
  const kept: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!value) continue;
    let known: string[];
    if (MUSCLE_GROUP_SET.has(value) || isRegionKey(value)) known = [value];
    else {
      // An older word: its one region ("upper_back" → middle_back), else its group ("cardio" → full_body).
      const regions = regionsForMuscle(value);
      const group = muscleGroupOf(value);
      known = regions.length === 1 || !group ? regions : [group];
    }
    for (const item of known) if (!kept.includes(item)) kept.push(item);
  }
  return kept;
}

/** Known equipment filter values ("bands" → resistance_band is the caller's job); order kept, no repeats. */
export function normaliseUsesValues(values: Iterable<string>): string[] {
  const known = new Set(USES_VALUES);
  return [...new Set([...values].map((value) => String(value ?? "").trim()).filter((value) => known.has(value)))];
}

/** The equipment keys a uses filter stands for ("machines" → its three keys; "none" stays "none"). */
export function expandUses(values: readonly string[]): string[] {
  return [...new Set(values.flatMap((value) => (value === MACHINES ? MACHINE_KEYS : [value])))];
}

// ---------------------------------------------------------------- the query

/** One library question: a search and filters. Lists are OR within, AND across; empty lists mean "any". */
export type CatalogQuery = {
  q: string;
  focus: readonly FocusArea[];
  /** Group or region keys (normaliseMuscleValues); "full_body" means the full-body rule. */
  muscles: readonly string[];
  categories: readonly ExerciseCategory[];
  difficulties: readonly Level[];
  /** Equipment the exercise uses: keys, "none" or "machines". */
  uses: readonly string[];
  movements: readonly Movement[];
  mechanics: readonly Mechanic[];
  /** "home": home-friendly equipment, or doable with what the member has. "gym" and null: anywhere. */
  environment: TrainingContext | null;
  /** Only these exercises (saved ones); null: any. */
  ids: readonly string[] | null;
  /** Only exercises the member can do with `owned` (ignored while `owned` is unknown). */
  doableOnly: boolean;
  sort: CatalogSort;
};

export const EMPTY_QUERY: CatalogQuery = {
  q: "", focus: [], muscles: [], categories: [], difficulties: [], uses: [], movements: [], mechanics: [], environment: null, ids: null,
  doableOnly: false, sort: "best",
};

export type QueryContext = {
  /** Equipment the member has, expanded (expandOwnedEquipment); null when not known. */
  owned: ReadonlySet<string> | null;
  /** The member's level: exercises above it come later in "best match". */
  level?: Level | null;
};

export type RankedExercise = {
  exercise: CatalogExercise;
  /** True when the member has every required item; null when their equipment is not known. */
  doable: boolean | null;
  /** Required items the member lacks (empty when doable or unknown). */
  missing: string[];
  /** With focus areas chosen: 0 when the exercise trains one as its main muscle, 1 when it only assists; else null. */
  focusTier: 0 | 1 | null;
  /** 2 per chosen area trained as the main muscle, 1 per area assisted (focus.ts focusScore). */
  focusScore: number;
  /** The search match; null without a search. */
  match: SearchMatch | null;
};

/** The facets a query can drop, for "remove this filter" suggestions. */
export const QUERY_FACETS = ["q", "focus", "muscles", "categories", "difficulties", "uses", "movements", "mechanics", "environment", "ids", "doableOnly"] as const;
export type QueryFacet = (typeof QUERY_FACETS)[number];

/** The query with one facet cleared. */
export function withoutFacet(query: CatalogQuery, facet: QueryFacet): CatalogQuery {
  const cleared: Record<QueryFacet, Partial<CatalogQuery>> = {
    q: { q: "" }, focus: { focus: [] }, muscles: { muscles: [] }, categories: { categories: [] }, difficulties: { difficulties: [] },
    uses: { uses: [] }, movements: { movements: [] }, mechanics: { mechanics: [] }, environment: { environment: null }, ids: { ids: null },
    doableOnly: { doableOnly: false },
  };
  return { ...query, ...cleared[facet] };
}

/** True when the facet narrows the results. */
export function facetActive(query: CatalogQuery, facet: QueryFacet): boolean {
  const value = query[facet];
  if (facet === "q") return Boolean(normalizeQuery(query.q));
  if (facet === "environment") return query.environment === "home";
  if (facet === "ids") return query.ids !== null;
  if (facet === "doableOnly") return query.doableOnly;
  return Array.isArray(value) && value.length > 0;
}

function musclesMatch(exercise: CatalogExercise, values: readonly string[], primary: () => readonly RegionKey[]): boolean {
  return values.some((value) => {
    if (value === "full_body") return isFullBodyExercise(exercise);
    if (exercise.muscle_group === value) return true;
    return isRegionKey(value) && primary().includes(value);
  });
}

function usesMatch(required: readonly string[], values: readonly string[]): boolean {
  return values.some((value) => (value === NO_EQUIPMENT ? required.length === 0 : value === MACHINES ? required.some((key) => MACHINE_KEYS.includes(key)) : required.includes(value)));
}

type Prepared = {
  query: CatalogQuery;
  plan: SearchPlan | null;
  ids: ReadonlySet<string> | null;
  focus: readonly FocusArea[];
};

function prepare(query: CatalogQuery): Prepared {
  const q = normalizeQuery(query.q);
  const plan = q ? parseSearch(q) : null;
  return { query, plan: plan && plan.terms.length ? plan : null, ids: query.ids ? new Set(query.ids) : null, focus: FOCUS_AREAS.filter((area) => query.focus.includes(area)) };
}

/** Matches one exercise against a prepared query; null when it is filtered out. */
function evaluate(exercise: CatalogExercise, prepared: Prepared, context: QueryContext): RankedExercise | null {
  const { query, plan, ids, focus } = prepared;
  if (ids && !ids.has(exercise.id)) return null;
  if (query.categories.length && !query.categories.includes(exercise.category)) return null;
  if (query.difficulties.length && !query.difficulties.includes(exercise.difficulty)) return null;
  if (query.mechanics.length && !(exercise.mechanic && query.mechanics.includes(exercise.mechanic))) return null;
  if (query.movements.length) {
    const movement = movementOf(exercise.movement_pattern);
    if (!movement || !query.movements.includes(movement)) return null;
  }
  if (query.uses.length && !usesMatch(exercise.required_equipment, query.uses)) return null;
  let primaryRegions: readonly RegionKey[] | null = null;
  const primary = () => (primaryRegions ??= exerciseRegions(exercise.primary_muscle, exercise.secondary_muscles).primary);
  if (query.muscles.length && !musclesMatch(exercise, query.muscles, primary)) return null;

  const owned = context.owned;
  const missing = owned ? missingEquipment(exercise.required_equipment, owned) : [];
  const doable = owned ? missing.length === 0 : null;
  if (query.doableOnly && doable === false) return null;
  if (query.environment === "home" && !exercise.locations.includes("home") && doable !== true) return null;

  let focusTier: 0 | 1 | null = null;
  let focusScore = 0;
  if (focus.length) {
    for (const area of focus) {
      const role = focusRole(exercise, area);
      if (role === "primary") { focusScore += 2; focusTier = 0; }
      else if (role === "secondary") { focusScore += 1; if (focusTier === null) focusTier = 1; }
    }
    if (focusTier === null) return null;
  }

  let match: SearchMatch | null = null;
  if (plan) {
    match = matchExercise(exercise, plan, { isFullBody: (item) => isFullBodyExercise(item as CatalogExercise) });
    if (!match) return null;
  }
  return { exercise, doable, missing, focusTier, focusScore, match };
}

const MECHANIC_ORDER: Record<string, number> = { compound: 0, isolation: 1 };
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en");

/**
 * The "best match" order (see the module comment). Stretches follow every training exercise unless the member
 * asked for stretching (`stretchesLast` false). Deterministic.
 */
export function compareRanked(a: RankedExercise, b: RankedExercise, level?: Level | null, stretchesLast = true): number {
  const band = (item: RankedExercise) => (item.match ? relevanceBand(item.match.score) : 0);
  const stretch = (item: RankedExercise) => (stretchesLast && item.exercise.category === "stretching" ? 1 : 0);
  const doable = (item: RankedExercise) => (item.doable === true ? 0 : item.doable === null ? 1 : 2);
  const staple = (item: RankedExercise) => stapleRank(item.exercise.id) ?? Number.POSITIVE_INFINITY;
  const userLevel = level ? levelRank(level) : null;
  const gap = (item: RankedExercise) => (userLevel === null ? 0 : Math.max(0, levelRank(item.exercise.difficulty) - userLevel));
  return band(b) - band(a)
    || (a.focusTier ?? 2) - (b.focusTier ?? 2)
    || stretch(a) - stretch(b)
    || doable(a) - doable(b)
    || b.focusScore - a.focusScore
    || staple(a) - staple(b)
    || (b.match?.score ?? 0) - (a.match?.score ?? 0)
    || gap(a) - gap(b)
    || (MECHANIC_ORDER[a.exercise.mechanic ?? ""] ?? 2) - (MECHANIC_ORDER[b.exercise.mechanic ?? ""] ?? 2)
    || byName(a.exercise, b.exercise)
    || a.exercise.id.localeCompare(b.exercise.id);
}

/** A sorted copy: by name, or by difficulty (beginner first) and then name. */
export function sortCatalog<T extends { name: string; difficulty: string }>(exercises: readonly T[], sort: CatalogSort): T[] {
  return [...exercises].sort(sort === "difficulty" ? (a, b) => levelRank(a.difficulty) - levelRank(b.difficulty) || byName(a, b) : byName);
}

export type QueryResult = {
  items: RankedExercise[];
  /** With focus areas and "best match": the index of the first exercise that only assists them, else null. */
  assistFrom: number | null;
  /** How many results the member can do; null when their equipment is not known. */
  doableCount: number | null;
};

/** Every exercise of `catalog` that answers the query, in the query's order. */
export function queryCatalog(catalog: readonly CatalogExercise[], query: CatalogQuery, context: QueryContext): QueryResult {
  const prepared = prepare(query);
  const items: RankedExercise[] = [];
  for (const exercise of catalog) {
    const ranked = evaluate(exercise, prepared, context);
    if (ranked) items.push(ranked);
  }
  const stretchesLast = !query.categories.includes("stretching");
  if (query.sort === "best") items.sort((a, b) => compareRanked(a, b, context.level, stretchesLast));
  else {
    const order = new Map(sortCatalog(items.map((item) => item.exercise), query.sort).map((exercise, index) => [exercise.id, index]));
    items.sort((a, b) => (order.get(a.exercise.id) ?? 0) - (order.get(b.exercise.id) ?? 0));
  }
  const firstAssist = query.sort === "best" && prepared.focus.length && !prepared.plan ? items.findIndex((item) => item.focusTier === 1) : -1;
  return {
    items,
    assistFrom: firstAssist >= 0 ? firstAssist : null,
    doableCount: context.owned ? items.filter((item) => item.doable).length : null,
  };
}

/** How many exercises answer the query (no sorting). */
export function countCatalog(catalog: readonly CatalogExercise[], query: CatalogQuery, context: QueryContext): number {
  const prepared = prepare(query);
  let count = 0;
  for (const exercise of catalog) if (evaluate(exercise, prepared, context)) count += 1;
  return count;
}

export type FocusAreaCount = {
  /** Exercises the query would show with only this area chosen (main or assisting muscle). */
  total: number;
  /** How many of those the member can do; null when their equipment is not known. */
  doable: number | null;
};

/**
 * For the focus tiles: per area, what queryCatalog would show with the query's other filters and only that area
 * chosen (`items.length` and `doableCount`), so a tile's figures match the results it opens.
 */
export function focusAreaCounts(catalog: readonly CatalogExercise[], query: CatalogQuery, context: QueryContext): Record<FocusArea, FocusAreaCount> {
  const counts = Object.fromEntries(FOCUS_AREAS.map((area) => [area, { total: 0, doable: context.owned ? 0 : null }])) as Record<FocusArea, FocusAreaCount>;
  const prepared = prepare({ ...query, focus: [] });
  for (const exercise of catalog) {
    const ranked = evaluate(exercise, prepared, context);
    if (!ranked) continue;
    for (const area of FOCUS_AREAS) {
      if (!focusRole(exercise, area)) continue;
      counts[area].total += 1;
      if (ranked.doable) counts[area].doable = (counts[area].doable ?? 0) + 1;
    }
  }
  return counts;
}

export type RelaxSuggestion = { facet: QueryFacet; count: number };

/**
 * For an empty result: how many exercises each active facet hides, as "remove this and see N". Only facets that
 * would show something, most results first.
 */
export function relaxSuggestions(catalog: readonly CatalogExercise[], query: CatalogQuery, context: QueryContext): RelaxSuggestion[] {
  return QUERY_FACETS.filter((facet) => facetActive(query, facet))
    .map((facet) => ({ facet, count: countCatalog(catalog, withoutFacet(query, facet), context) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || QUERY_FACETS.indexOf(a.facet) - QUERY_FACETS.indexOf(b.facet));
}

// ---------------------------------------------------------------- API parameters

export type CatalogSearchParams = {
  /** Name search, trimmed and single-spaced (smart search: synonyms, joined words, muscle and equipment words). */
  q: string;
  /** Training-level muscle groups (muscle_group). */
  muscleGroups: MuscleGroup[];
  /** Body-map regions, as the exercise's primary muscle. With muscleGroups, an exercise may match either. */
  primary: RegionKey[];
  /** Focus areas (main or assisting muscle). */
  focus: FocusArea[];
  categories: ExerciseCategory[];
  difficulties: Level[];
  /** "home" or "gym": the exercise's derived locations must include it. */
  location: TrainingContext | null;
  /** Equipment the exercise uses (any of): keys, "none" (needs nothing) or "machines". */
  equipment: string[];
  /** Equipment the user has (already expanded). null: no filter; []: only exercises that need nothing. */
  doable: string[] | null;
  movements: Movement[];
  mechanics: Mechanic[];
  /** Only these exercise ids (saved or recently viewed ones), at most MAX_IDS. null: any exercise. */
  ids: string[] | null;
  sort: CatalogSort;
  /** 1-based. */
  page: number;
  pageSize: number;
};

export const DEFAULT_SEARCH_PARAMS: CatalogSearchParams = {
  q: "", muscleGroups: [], primary: [], focus: [], categories: [], difficulties: [], location: null, equipment: [], doable: null, movements: [],
  mechanics: [], ids: null, sort: "name", page: 1, pageSize: DEFAULT_PAGE_SIZE,
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const KNOWN_EQUIPMENT = new Set(EQUIPMENT_KEYS);

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

/** A whole number from a query value, clamped to [min, max]; `fallback` when it is missing or not a number. */
export function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null || value.trim() === "" ? Number.NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Comma-separated values, trimmed, de-duplicated, keeping only those `keep` accepts, in order. */
function listParam(value: string | null, keep: (item: string) => boolean, max: number, maxLength = Number.POSITIVE_INFINITY): string[] {
  const items: string[] = [];
  let length = 0;
  for (const item of new Set((value ?? "").split(",").map((part) => part.trim()))) {
    if (!item || !keep(item)) continue;
    if (items.length >= max || length + item.length + 1 > maxLength) break;
    items.push(item);
    length += item.length + 1;
  }
  return items;
}

function listOf<T extends string>(values: readonly T[], value: string | null): T[] {
  return listParam(value, (item) => (values as readonly string[]).includes(item), values.length) as T[];
}

/** Collapses whitespace and caps the length, so the same search always gives the same query. */
export function normalizeQuery(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH).trim();
}

/**
 * Reads GET /api/exercises parameters. Unknown keys are ignored, unknown values are dropped and numbers are
 * clamped, so a hand-edited URL never errors. List parameters are comma-separated; a single value still works.
 */
export function parseCatalogSearchParams(input: URLSearchParams): CatalogSearchParams {
  const sort = input.get("sort");
  return {
    q: normalizeQuery(input.get("q")),
    muscleGroups: listOf(MUSCLE_GROUPS, input.get("muscle_group")),
    primary: listOf(BODY_REGIONS, input.get("primary")),
    focus: parseFocusParam(input.get("focus")),
    categories: listOf(EXERCISE_CATEGORIES, input.get("category")),
    difficulties: listOf(LEVELS, input.get("difficulty")),
    location: oneOf(TRAINING_CONTEXTS, input.get("location")),
    equipment: listParam(input.get("equipment"), (key) => USES_VALUES.includes(key), USES_VALUES.length),
    // Present but empty means "I have no equipment"; unknown keys cannot satisfy anything, so they drop out.
    doable: input.has("doable") ? listParam(input.get("doable"), (key) => KNOWN_EQUIPMENT.has(key), KNOWN_EQUIPMENT.size) : null,
    movements: listOf(MOVEMENTS, input.get("movement")),
    mechanics: listOf(MECHANICS, input.get("mechanic")),
    ids: input.has("ids") ? listParam(input.get("ids"), (id) => ID_PATTERN.test(id), MAX_IDS, MAX_IDS_LENGTH) : null,
    sort: sort === "difficulty" || sort === "best" ? sort : "name",
    page: clampInt(input.get("page"), 1, 1, MAX_PAGE),
    pageSize: clampInt(input.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
  };
}

/** The query string for GET /api/exercises; parseCatalogSearchParams reads it back unchanged. */
export function catalogSearchQuery(params: Partial<CatalogSearchParams>): URLSearchParams {
  const query = new URLSearchParams();
  const q = normalizeQuery(params.q);
  const list = (key: string, values: readonly string[] | undefined) => { if (values?.length) query.set(key, values.join(",")); };
  if (q) query.set("q", q);
  list("muscle_group", params.muscleGroups);
  list("primary", params.primary);
  list("focus", params.focus);
  list("category", params.categories);
  list("difficulty", params.difficulties);
  if (params.location) query.set("location", params.location);
  list("equipment", params.equipment);
  if (params.doable) query.set("doable", [...params.doable].sort().join(","));
  list("movement", params.movements);
  list("mechanic", params.mechanics);
  if (params.ids) query.set("ids", params.ids.join(","));
  if (params.sort === "difficulty" || params.sort === "best") query.set("sort", params.sort);
  if (params.page && params.page > 1) query.set("page", String(params.page));
  if (params.pageSize && params.pageSize !== DEFAULT_PAGE_SIZE) query.set("pageSize", String(params.pageSize));
  return query;
}

/** The library query for API parameters (`doable` doubles as the member's equipment). */
export function queryFromParams(params: CatalogSearchParams): { query: CatalogQuery; context: QueryContext } {
  return {
    query: {
      q: params.q, focus: params.focus, muscles: [...params.muscleGroups, ...params.primary], categories: params.categories,
      difficulties: params.difficulties, uses: params.equipment, movements: params.movements, mechanics: params.mechanics,
      environment: null, ids: params.ids, doableOnly: params.doable !== null, sort: params.sort,
    },
    context: { owned: params.doable ? new Set(params.doable) : null },
  };
}

// ---------------------------------------------------------------- plain name words (database patterns)

/**
 * The words of a name search, lower-case, for plain database patterns. Punctuation at the edges of a word is
 * dropped ("rowing," -> "rowing"); `*` is removed because PostgREST reads it as a wildcard in like patterns.
 * The library itself uses the smart search (search-terms.ts).
 */
export function searchWords(q: string): string[] {
  // Non-ASCII characters count as letters, so accented words keep their edges.
  const words = normalizeQuery(q).toLowerCase().replace(/\*/g, " ").split(" ")
    .map((word) => word.replace(/^[^a-z0-9À-￿]+|[^a-z0-9À-￿]+$/g, ""))
    .filter(Boolean);
  return [...new Set(words)].slice(0, MAX_SEARCH_WORDS);
}

/** Escapes LIKE/ILIKE wildcards (`%`, `_`) and the escape character itself, so they match literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** An ILIKE pattern matching names that contain `word`. */
export function containsPattern(word: string): string {
  return `%${escapeLike(word)}%`;
}

// ---------------------------------------------------------------- in-memory search

/** A matcher for the API's filters over estimated or curated exercises (smart name search included). */
export function catalogMatcher(params: CatalogSearchParams): (exercise: CatalogExercise) => boolean {
  const { query, context } = queryFromParams(params);
  const prepared = prepare(query);
  return (exercise) => (!params.location || exercise.locations.includes(params.location)) && evaluate(exercise, prepared, context) !== null;
}

export function filterCatalog(exercises: readonly CatalogExercise[], params: CatalogSearchParams): CatalogExercise[] {
  return exercises.filter(catalogMatcher(params));
}

/** The API's in-memory answer: filtered with its parameters, then ranked or sorted. */
function rankForParams(exercises: readonly CatalogExercise[], params: CatalogSearchParams): CatalogExercise[] {
  const { query, context } = queryFromParams(params);
  const located = params.location ? exercises.filter((exercise) => exercise.locations.includes(params.location!)) : exercises;
  return queryCatalog(located, query, context).items.map((item) => item.exercise);
}

/** Row offsets for a 1-based page, as `range(from, to)` takes them (inclusive). */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/** One page of `items` and the total; a page past the end is empty. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): { items: T[]; total: number } {
  const { from, to } = pageRange(page, pageSize);
  return { items: items.slice(from, to + 1), total: items.length };
}

/**
 * For a difficulty-sorted page: which rows to read from each level, given how many match per level.
 * Postgres sorts the text values alphabetically (advanced first), so each level is read on its own,
 * by name, and the page is stitched together in beginner, intermediate, advanced order.
 */
export function difficultyWindows(counts: ReadonlyArray<{ level: Level; count: number }>, from: number, to: number): Array<{ level: Level; from: number; to: number }> {
  const windows: Array<{ level: Level; from: number; to: number }> = [];
  let offset = 0;
  for (const { level, count } of [...counts].sort((a, b) => levelRank(a.level) - levelRank(b.level))) {
    const start = Math.max(from, offset);
    const end = Math.min(to, offset + count - 1);
    if (count > 0 && start <= end) windows.push({ level, from: start - offset, to: end - offset });
    offset += count;
  }
  return windows;
}

// ---------------------------------------------------------------- database

type Db = Pick<SupabaseClient, "from">;

export type CatalogSearchOutcome =
  | { error: null; exercises: CatalogExercise[]; total: number; curated: boolean }
  | { error: unknown; exercises: []; total: 0; curated: false };

const TABLE = "exercise_library";
const CURATED_SELECT = [...CATALOG_BASE_COLUMNS, ...CATALOG_V2_COLUMNS].join(",");
const LEGACY_SELECT = CATALOG_BASE_COLUMNS.join(",");
/** Rows per request when reading the whole catalogue (PostgREST's usual max-rows). */
const ROW_BATCH = 1000;
const MAX_ROWS = 5000;
/** PostgREST: the requested offset is past the last row (HTTP 416). */
const RANGE_NOT_SATISFIABLE = "PGRST103";

function failed(error: unknown): CatalogSearchOutcome {
  return { error, exercises: [], total: 0, curated: false };
}

function errorCode(error: unknown): string | null {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
  return typeof code === "string" ? code : null;
}

/** True when some active exercise has been through the catalogue clean-up. */
async function probeCurated(db: Db): Promise<{ error: unknown; curated: boolean }> {
  const result = await db.from(TABLE).select("id").eq("is_active", true).gte("catalog_version", 1).limit(1);
  if (result.error) return { error: result.error, curated: false };
  return { error: null, curated: (result.data ?? []).length > 0 };
}

/** Filters that read the clean-up's values: rows it has not reached are left out of them instead of matching by accident. */
function readsCuratedValues(params: CatalogSearchParams): boolean {
  return Boolean(params.muscleGroups.length || params.primary.length || params.focus.length || params.categories.length || params.location
    || params.equipment.length || params.doable || params.movements.length || params.mechanics.length);
}

/**
 * True when the database alone can answer: no search, focus or ranking, and filters it can express. Full body is
 * a rule (isFullBodyExercise), not the muscle_group column, so it always runs in memory.
 */
function databaseCanAnswer(params: CatalogSearchParams): boolean {
  return !params.q && !params.focus.length && params.sort !== "best" && !params.equipment.includes(NO_EQUIPMENT)
    && !params.muscleGroups.includes("full_body")
    && !(params.muscleGroups.length && params.primary.length);
}

/** Every filter in Postgres; pages by name, or by difficulty level then name. */
async function curatedSearch(db: Db, params: CatalogSearchParams): Promise<CatalogSearchOutcome> {
  const curatedOnly = readsCuratedValues(params);
  const filtered = (columns: string, options?: { count: "exact"; head?: boolean }) => {
    let query = db.from(TABLE).select(columns, options).eq("is_active", true);
    if (params.muscleGroups.length) query = query.in("muscle_group", params.muscleGroups);
    if (params.primary.length) query = query.in("primary_muscle", params.primary);
    if (params.categories.length) query = query.in("category", params.categories);
    if (params.location) query = query.contains("locations", [params.location]);
    if (params.equipment.length) query = query.overlaps("required_equipment", expandUses(params.equipment));
    if (params.doable) query = query.containedBy("required_equipment", params.doable);
    if (params.movements.length) query = query.in("movement_pattern", params.movements.flatMap((movement) => MOVEMENT_PATTERNS[movement]));
    if (params.mechanics.length) query = query.in("mechanic", params.mechanics);
    if (params.ids) query = query.in("id", params.ids);
    if (curatedOnly) query = query.gte("catalog_version", 1);
    return query;
  };
  const { from, to } = pageRange(params.page, params.pageSize);
  const toExercises = (rows: unknown) => ((rows ?? []) as CatalogRow[]).map(toCatalogExercise);
  const levels = params.difficulties.length ? LEVELS.filter((level) => params.difficulties.includes(level)) : [...LEVELS];

  if (params.sort === "name" || levels.length === 1) {
    const level = (query: ReturnType<typeof filtered>) => (!params.difficulties.length ? query : levels.length === 1 ? query.eq("difficulty", levels[0]) : query.in("difficulty", levels));
    const result = await level(filtered(CURATED_SELECT, { count: "exact" })).order("name").range(from, to);
    if (result.error && errorCode(result.error) === RANGE_NOT_SATISFIABLE) {
      const counted = await level(filtered("id", { count: "exact", head: true }));
      if (counted.error) return failed(counted.error);
      return { error: null, exercises: [], total: counted.count ?? 0, curated: true };
    }
    if (result.error) return failed(result.error);
    const exercises = toExercises(result.data);
    return { error: null, exercises, total: result.count ?? from + exercises.length, curated: true };
  }

  const counted = await Promise.all(levels.map((level) => filtered("id", { count: "exact", head: true }).eq("difficulty", level)));
  const countError = counted.find((result) => result.error)?.error;
  if (countError) return failed(countError);
  const counts = levels.map((level, index) => ({ level, count: counted[index].count ?? 0 }));
  const pages = await Promise.all(difficultyWindows(counts, from, to)
    .map((window) => filtered(CURATED_SELECT).eq("difficulty", window.level).order("name").range(window.from, window.to)));
  const pageError = pages.find((result) => result.error)?.error;
  if (pageError) return failed(pageError);
  return {
    error: null,
    exercises: pages.flatMap((result) => toExercises(result.data)),
    total: counts.reduce((sum, item) => sum + item.count, 0),
    curated: true,
  };
}

/**
 * Searches and rankings in memory: the active rows are read (exact filters on difficulty and ids still run in
 * Postgres), then filtered, ranked and paged here with the same rules as the library page.
 */
async function memorySearch(db: Db, params: CatalogSearchParams, curated: boolean): Promise<CatalogSearchOutcome> {
  const rows: CatalogRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += ROW_BATCH) {
    let query = db.from(TABLE).select(curated ? CURATED_SELECT : LEGACY_SELECT).eq("is_active", true);
    if (params.difficulties.length === 1) query = query.eq("difficulty", params.difficulties[0]);
    else if (params.difficulties.length) query = query.in("difficulty", params.difficulties);
    if (params.ids) query = query.in("id", params.ids);
    const result = await query.order("name").range(from, from + ROW_BATCH - 1);
    if (result.error) return failed(result.error);
    const batch = (result.data ?? []) as unknown as CatalogRow[];
    rows.push(...batch);
    if (batch.length < ROW_BATCH) break;
  }
  let exercises = rows.map(toCatalogExercise);
  if (curated && readsCuratedValues(params)) exercises = exercises.filter((exercise) => exercise.curated);
  const page = paginate(rankForParams(exercises, params), params.page, params.pageSize);
  return { error: null, exercises: page.items, total: page.total, curated };
}

/**
 * One page of the library for `params`, read with the caller's client (so row-level security
 * applies: merged duplicates are inactive and never returned).
 */
export async function searchCatalog(db: Db, params: CatalogSearchParams): Promise<CatalogSearchOutcome> {
  const inDatabase = databaseCanAnswer(params);
  // The probe and the database query run together; the database answer is used only if the probe agrees.
  const [probe, curated] = await Promise.all([probeCurated(db), inDatabase ? curatedSearch(db, params) : Promise.resolve(null)]);
  if (probe.error && !isMissingColumnError(probe.error, CATALOG_V2_COLUMNS)) return failed(probe.error);
  if (probe.curated && curated) return curated;
  return memorySearch(db, params, probe.curated);
}

/**
 * The first still for each exercise: the exercise_media rows (self-hosted copy first), else the
 * pinned Free Exercise DB photo. A missing table (media migration not applied) is not an error;
 * any other failure is returned for logging, with the pinned photos still filled in.
 */
export async function loadCatalogThumbnails(db: Db, exercises: readonly Pick<CatalogExercise, "id" | "name" | "source_ref">[], supabaseUrl: string | null | undefined): Promise<{ error: unknown; thumbnails: Map<string, string | null> }> {
  const thumbnails = new Map<string, string | null>();
  if (!exercises.length) return { error: null, thumbnails };
  const result = await db.from("exercise_media").select(EXERCISE_MEDIA_COLUMNS.join(","))
    .in("exercise_id", exercises.map((exercise) => exercise.id)).eq("kind", "still").order("position");
  const rows = result.error ? null : ((result.data ?? []) as unknown as ExerciseMediaRow[]);
  const grouped = groupMediaRows(rows ?? []);
  for (const exercise of exercises) {
    const media = resolveExerciseMedia({ exerciseId: exercise.id, name: exercise.name, sourceRef: exercise.source_ref, rows: rows ? grouped.get(exercise.id) ?? [] : null, supabaseUrl });
    thumbnails.set(exercise.id, media.stills[0]?.url ?? null);
  }
  return { error: result.error && !isMissingTableError(result.error) ? result.error : null, thumbnails };
}
