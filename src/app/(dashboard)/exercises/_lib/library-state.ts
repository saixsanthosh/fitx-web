import { REGIONS, isRegionKey } from "@/lib/training/anatomy";
import {
  MACHINES,
  MOVEMENTS,
  MOVEMENT_LABELS,
  NO_EQUIPMENT,
  normaliseMuscleValues,
  normaliseUsesValues,
  type CatalogQuery,
  type Movement,
  type QueryFacet,
} from "@/lib/training/catalog-search";
import { equipmentKeyFor, equipmentLabel, sortEquipmentKeys } from "@/lib/training/equipment";
import { FOCUS_AREAS, FOCUS_AREA_INFO, focusLabel, parseFocusParam, type FocusArea } from "@/lib/training/focus";
import { parseSearch, textTokens } from "@/lib/training/search-terms";
import {
  CATEGORY_LABELS,
  EQUIPMENT_KEYS,
  EXERCISE_CATEGORIES,
  LEVELS,
  MECHANICS,
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUPS,
  type ExerciseCategory,
  type Level,
  type Mechanic,
  type MuscleGroup,
  type TrainingContext,
} from "@/lib/training/taxonomy";

/**
 * What the exercise library shows, as kept in its URL, e.g.
 * `/exercises?q=press&focus=chest,arms&uses=barbell&have=dumbbell,bench&difficulty=beginner&doable=1`.
 *
 * Lists are comma-separated (one value still works). Links made by earlier versions keep working: `location`
 * is the context, `equipment` is "uses" (an equipment word such as `bands` or `body only` is read as its key),
 * a fine muscle (`muscle=lats`) is that muscle, `muscle=full_body` is the Full body focus and `movement` is read
 * again. writeLibraryState always writes the current keys, in a fixed order.
 */
export type LibrarySort = "best" | "name" | "difficulty";

export type LibraryState = {
  /** The search box, as typed. */
  q: string;
  /** Home Workout or Gym Workout (the default): which saved equipment list applies, and at home, home-friendly exercises. */
  context: TrainingContext;
  /** "Only show what I can do". */
  doable: boolean;
  focus: FocusArea[];
  /** Muscle group or body-map region keys. */
  muscles: string[];
  /** Equipment the exercise uses: keys, "none" (body weight) or "machines". */
  uses: string[];
  /** Equipment the member has for this search; null: their saved list for the context; []: no equipment. */
  have: string[] | null;
  difficulties: Level[];
  categories: ExerciseCategory[];
  movements: Movement[];
  mechanics: Mechanic[];
  /** Only saved exercises. */
  saved: boolean;
  sort: LibrarySort;
};

export const DEFAULT_LIBRARY_STATE: LibraryState = {
  q: "", context: "gym", doable: false, focus: [], muscles: [], uses: [], have: null, difficulties: [], categories: [], movements: [],
  mechanics: [], saved: false, sort: "best",
};

/** Every key the library reads, including the older ones it rewrites. */
export const LIBRARY_KEYS = ["q", "context", "location", "focus", "muscle", "uses", "equipment", "have", "doable", "difficulty", "category", "movement", "mechanic", "saved", "sort"] as const;

function values(params: URLSearchParams, ...keys: string[]): string[] {
  return keys.flatMap((key) => params.getAll(key)).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

function known<T extends string>(list: readonly T[], items: readonly string[]): T[] {
  return list.filter((value) => items.includes(value));
}

/** An equipment word or key as a "uses" value: "none" for body weight, "machines", a key, or null. */
function usesValue(word: string): string | null {
  const plain = word.trim();
  if (plain === NO_EQUIPMENT || plain === MACHINES || EQUIPMENT_KEYS.includes(plain)) return plain;
  const key = equipmentKeyFor(plain);
  return key === "" ? NO_EQUIPMENT : key;
}

/** Reads the library state from a query string. Unknown values are ignored. */
export function readLibraryState(search: string): LibraryState {
  const params = new URLSearchParams(search);
  const context = params.get("context") ?? params.get("location");
  const muscleWords = values(params, "muscle");
  const muscles = normaliseMuscleValues(muscleWords);
  // "Full body" was a muscle group with one exercise; it is the Full body focus now.
  const focus = parseFocusParam([...values(params, "focus"), ...(muscles.includes("full_body") ? ["full_body"] : [])]);
  let have: string[] | null = null;
  if (params.has("have")) {
    const words = values(params, "have");
    const keys = sortEquipmentKeys(words.map(usesValue).filter((key): key is string => Boolean(key) && key !== NO_EQUIPMENT && key !== MACHINES));
    have = keys.length || !words.length || words.some((word) => usesValue(word) === NO_EQUIPMENT) ? keys : null;
  }
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    context: context === "home" ? "home" : "gym",
    doable: params.get("doable") === "1",
    focus,
    muscles: muscles.filter((value) => value !== "full_body"),
    uses: normaliseUsesValues(values(params, "uses", "equipment").map(usesValue).filter((value): value is string => Boolean(value))),
    have,
    difficulties: known(LEVELS, values(params, "difficulty")),
    categories: known(EXERCISE_CATEGORIES, values(params, "category")),
    movements: known(MOVEMENTS, values(params, "movement")),
    mechanics: known(MECHANICS, values(params, "mechanic")),
    saved: params.get("saved") === "1",
    sort: sort === "name" || sort === "difficulty" ? sort : "best",
  };
}

/** The query string for a state (no "?"): current keys only, defaults left out, a fixed order. */
export function writeLibraryState(state: LibraryState): string {
  const params = new URLSearchParams();
  const list = (key: string, items: readonly string[]) => { if (items.length) params.set(key, items.join(",")); };
  if (state.q.trim()) params.set("q", state.q);
  if (state.context === "home") params.set("context", "home");
  list("focus", FOCUS_AREAS.filter((area) => state.focus.includes(area)));
  list("muscle", state.muscles);
  list("uses", state.uses);
  if (state.have) params.set("have", state.have.length ? sortEquipmentKeys(state.have).join(",") : NO_EQUIPMENT);
  if (state.doable) params.set("doable", "1");
  list("difficulty", LEVELS.filter((level) => state.difficulties.includes(level)));
  list("category", EXERCISE_CATEGORIES.filter((category) => state.categories.includes(category)));
  list("movement", MOVEMENTS.filter((movement) => state.movements.includes(movement)));
  list("mechanic", MECHANICS.filter((mechanic) => state.mechanics.includes(mechanic)));
  if (state.saved) params.set("saved", "1");
  if (state.sort !== "best") params.set("sort", state.sort);
  return params.toString();
}

/** The same search written with the current keys (older links are rewritten once, on arrival). */
export function canonicalLibrarySearch(search: string): string {
  return writeLibraryState(readLibraryState(search));
}

export type LibraryParam = "q" | "context" | "doable" | "saved" | "sort";

/** `search` with one single-value setting changed; defaults are removed so URLs stay short. */
export function withLibraryParam(search: string, key: LibraryParam, value: string | boolean | null): string {
  const state = readLibraryState(search);
  const text = typeof value === "boolean" ? (value ? "1" : "") : (value ?? "");
  if (key === "q") state.q = text.trim() ? text : "";
  else if (key === "context") state.context = text === "home" ? "home" : "gym";
  else if (key === "doable") state.doable = text === "1";
  else if (key === "saved") state.saved = text === "1";
  else state.sort = text === "name" || text === "difficulty" ? text : "best";
  return writeLibraryState(state);
}

/** `search` without the search text and any filter, keeping the context (and the sort). */
export function withoutLibraryFilters(search: string): string {
  const state = readLibraryState(search);
  return writeLibraryState({ ...DEFAULT_LIBRARY_STATE, context: state.context, sort: state.sort });
}

/** The state without any filter chip ("Clear all"): the search text, context and sort stay. */
export function withoutFilters(state: LibraryState): LibraryState {
  return { ...DEFAULT_LIBRARY_STATE, q: state.q, context: state.context, sort: state.sort };
}

/** Adds the value when missing, removes it when present; keeps the order of `order` when given. */
export function toggleValue<T extends string>(list: readonly T[], value: T, order?: readonly T[]): T[] {
  const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  return order ? order.filter((item) => next.includes(item)) : next;
}

// ---------------------------------------------------------------- filter chips

export type ChipKey = "focus" | "muscle" | "uses" | "have" | "doable" | "difficulty" | "category" | "movement" | "mechanic" | "saved";

export type FilterChip = {
  key: ChipKey;
  /** The value the chip removes ("" for single settings). */
  value: string;
  /** What it filters by, for the chip and its remove button ("Uses"). */
  kind: string;
  label: string;
};

const MECHANIC_LABELS: Record<Mechanic, string> = { compound: "Compound", isolation: "Isolation" };

/** The label of a muscle filter value: the body-map name for a region, the group name otherwise. */
export function muscleValueLabel(value: string): string {
  if (isRegionKey(value)) return REGIONS[value].label;
  return (MUSCLE_GROUPS as readonly string[]).includes(value) ? MUSCLE_GROUP_LABELS[value as MuscleGroup] : value.replaceAll("_", " ");
}

/** The label of an equipment-it-uses value. */
export function usesLabel(value: string): string {
  if (value === NO_EQUIPMENT) return "Body weight";
  if (value === MACHINES) return "Machines";
  return equipmentLabel(value);
}

/** "Dumbbells, Weight bench and 2 more"; "No equipment" for an empty list. */
export function equipmentListText(keys: readonly string[], shown = 3): string {
  if (!keys.length) return "No equipment";
  const labels = keys.map(equipmentLabel);
  return labels.length <= shown + 1 ? joinWords(labels) : `${labels.slice(0, shown).join(", ")} and ${labels.length - shown} more`;
}

function joinWords(words: readonly string[]): string {
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const capitalise = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value);

/** Every active filter as a removable chip, in a fixed order. */
export function filterChips(state: LibraryState): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const area of FOCUS_AREAS) if (state.focus.includes(area)) chips.push({ key: "focus", value: area, kind: "Train", label: focusLabel(area) });
  for (const value of state.muscles) chips.push({ key: "muscle", value, kind: "Muscle", label: muscleValueLabel(value) });
  for (const value of state.uses) chips.push({ key: "uses", value, kind: "Uses", label: usesLabel(value) });
  if (state.have) chips.push({ key: "have", value: "", kind: "You have", label: equipmentListText(state.have, 2) });
  if (state.doable) chips.push({ key: "doable", value: "", kind: "Show", label: "Only what I can do" });
  for (const level of LEVELS) if (state.difficulties.includes(level)) chips.push({ key: "difficulty", value: level, kind: "Level", label: capitalise(level) });
  for (const category of EXERCISE_CATEGORIES) if (state.categories.includes(category)) chips.push({ key: "category", value: category, kind: "Type", label: CATEGORY_LABELS[category] });
  for (const movement of MOVEMENTS) if (state.movements.includes(movement)) chips.push({ key: "movement", value: movement, kind: "Movement", label: MOVEMENT_LABELS[movement] });
  for (const mechanic of MECHANICS) if (state.mechanics.includes(mechanic)) chips.push({ key: "mechanic", value: mechanic, kind: "Movement", label: MECHANIC_LABELS[mechanic] });
  if (state.saved) chips.push({ key: "saved", value: "", kind: "Show", label: "Saved" });
  return chips;
}

/** The state with one chip removed. */
export function withoutChip(state: LibraryState, chip: Pick<FilterChip, "key" | "value">): LibraryState {
  const drop = <T extends string>(list: readonly T[]) => list.filter((item) => item !== chip.value);
  switch (chip.key) {
    case "focus": return { ...state, focus: drop(state.focus) };
    case "muscle": return { ...state, muscles: drop(state.muscles) };
    case "uses": return { ...state, uses: drop(state.uses) };
    case "have": return { ...state, have: null };
    case "doable": return { ...state, doable: false };
    case "difficulty": return { ...state, difficulties: drop(state.difficulties) };
    case "category": return { ...state, categories: drop(state.categories) };
    case "movement": return { ...state, movements: drop(state.movements) };
    case "mechanic": return { ...state, mechanics: drop(state.mechanics) };
    case "saved": return { ...state, saved: false };
  }
}

/** How many filters the Filters panel holds (muscles, equipment it uses, level, type, movement). */
export function panelFilterCount(state: LibraryState): number {
  return state.muscles.length + state.uses.length + state.difficulties.length + state.categories.length + state.movements.length + state.mechanics.length;
}

/** All active filters (the chips). */
export function activeFilterCount(state: LibraryState): number {
  return filterChips(state).length;
}

// ---------------------------------------------------------------- helping an empty or wordy search

/** "Remove Barbell and Kettlebell": what dropping one kind of filter does, for empty results. */
export function relaxLabel(facet: QueryFacet, state: LibraryState): string {
  const remove = (labels: readonly string[]) => `Remove ${joinWords(labels)}`;
  switch (facet) {
    case "q": return "Clear the search";
    case "focus": return remove(state.focus.map(focusLabel));
    case "muscles": return remove(state.muscles.map(muscleValueLabel));
    case "categories": return remove(state.categories.map((category) => CATEGORY_LABELS[category]));
    case "difficulties": return remove(state.difficulties.map(capitalise));
    case "uses": return remove(state.uses.map(usesLabel));
    case "movements": return remove(state.movements.map((movement) => MOVEMENT_LABELS[movement]));
    case "mechanics": return remove(state.mechanics.map((mechanic) => MECHANIC_LABELS[mechanic]));
    case "environment": return "Search the gym library";
    case "ids": return "Show all exercises, not only saved";
    case "doableOnly": return "Include ones you can't do yet";
  }
}

/** The state with one kind of filter dropped (the counterpart of withoutFacet). */
export function relaxState(facet: QueryFacet, state: LibraryState): LibraryState {
  switch (facet) {
    case "q": return { ...state, q: "" };
    case "focus": return { ...state, focus: [] };
    case "muscles": return { ...state, muscles: [] };
    case "categories": return { ...state, categories: [] };
    case "difficulties": return { ...state, difficulties: [] };
    case "uses": return { ...state, uses: [] };
    case "movements": return { ...state, movements: [] };
    case "mechanics": return { ...state, mechanics: [] };
    case "environment": return { ...state, context: "gym", have: null };
    case "ids": return { ...state, saved: false };
    case "doableOnly": return { ...state, doable: false };
  }
}

const sameRegions = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item) => b.includes(item));

/**
 * A muscle word in the search that can become a filter: "pecs" → the Chest focus, "lats" → the Lats muscle,
 * "full body" → the Full body focus. Applying it moves the word out of the search into the filter. null when the
 * search has no such word, or its filter is already on.
 */
export function muscleWordFilter(state: LibraryState): { word: string; label: string; next: LibraryState } | null {
  const term = parseSearch(state.q).terms.find((item) => item.kind === "muscle" || item.kind === "full_body");
  if (!term) return null;
  const area = term.kind === "full_body" ? "full_body" : FOCUS_AREAS.find((key) => key !== "full_body" && sameRegions(FOCUS_AREA_INFO[key].regions, term.regions));
  let next: LibraryState;
  let label: string;
  if (area) {
    if (state.focus.includes(area)) return null;
    next = { ...state, focus: FOCUS_AREAS.filter((key) => key === area || state.focus.includes(key)) };
    label = focusLabel(area);
  } else if (term.regions.length === 1) {
    const region = term.regions[0];
    if (state.muscles.includes(region)) return null;
    next = { ...state, muscles: [...state.muscles, region] };
    label = REGIONS[region].label;
  } else {
    return null;
  }
  const termTokens = new Set(term.text.split(" "));
  const kept = state.q.split(/\s+/).filter((word) => {
    const tokens = textTokens(word);
    return tokens.length > 0 && !tokens.every((token) => termTokens.has(token));
  });
  return { word: term.text, label, next: { ...next, q: kept.join(" ") } };
}

/** The library question for this state; `savedIds` limits it to saved exercises when Saved is on. */
export function libraryQuery(state: LibraryState, savedIds: readonly string[]): CatalogQuery {
  return {
    q: state.q,
    focus: state.focus,
    muscles: state.muscles,
    categories: state.categories,
    difficulties: state.difficulties,
    uses: state.uses,
    movements: state.movements,
    mechanics: state.mechanics,
    environment: state.context === "home" ? "home" : null,
    ids: state.saved ? savedIds : null,
    doableOnly: state.doable,
    sort: state.sort,
  };
}
