/**
 * Focus areas: the body areas a member picks before training ("Chest", "Arms", "Full body"). Shared by the focus
 * area tiles (src/components/training/MuscleRail.tsx and src/components/workouts/AreaLaunchRail.tsx), the exercise library (`?focus=chest,arms`), the workout
 * generator (focusSlots in ./generator) and Home. Pure: it holds the vocabulary and works only on what the
 * caller passes in, so every count it returns comes from the catalogue it is given.
 *
 * How an exercise belongs to an area, from the catalogue's own muscle labels (never guessed):
 *  - Regions come from anatomy.ts (exerciseRegions), so the tiles, the library and the body map agree.
 *  - "primary": the exercise's primary muscle is one of the area's regions; "secondary": one of its secondary
 *    muscles is (or its primary muscle is one the area only assists with, e.g. traps for shoulders).
 *  - Full body is a rule, not a muscle: the catalogue's full_body group, the olympic and strongman categories,
 *    and compound movements whose listed muscles reach both the upper and the lower body.
 * focusScore ranks exercises: 2 per area an exercise trains as its primary muscle, 1 per area it assists.
 */
import { BODY_REGIONS, exerciseRegions, regionsForMuscle, type RegionKey } from "./anatomy";
import type { CatalogExercise } from "./catalog";
import { isDoableWith } from "./equipment";
import { pinnedPhotoUrl } from "./media";
import { stapleRank } from "./staples";
import { levelRank, type ExerciseCategory, type Level, type MuscleGroup } from "./taxonomy";

/** Area keys, in display order. Stable identifiers (URLs, saved choices): add keys, never rename one. */
export const FOCUS_AREAS = ["full_body", "chest", "back", "shoulders", "arms", "abs", "legs", "glutes"] as const;
export type FocusArea = (typeof FOCUS_AREAS)[number];

/** A Free Exercise DB photo (public domain) of one catalogue exercise, used as the area's tile picture. */
export type FocusPhoto = {
  /** The active catalogue exercise in the photo. */
  exerciseId: string;
  /** Its Free Exercise DB id (`exercise_library.source_ref`); the photo is served from the pinned revision. */
  sourceRef: string;
  /** Which of the exercise's two photos (0 or 1). */
  frame: 0 | 1;
  /** CSS object-position for the tile crop. */
  position: string;
};

export type FocusAreaInfo = {
  key: FocusArea;
  /** Tile and chip label, sentence case. */
  label: string;
  /** One short line naming what the area covers. */
  description: string;
  /**
   * Body-map regions the area trains (a mini map draws them as primary). Full body lists every region, for
   * display only: whether an exercise is full body is decided by the full-body rule, not by these regions.
   */
  regions: readonly RegionKey[];
  /** Regions the area also works, at a lower weight (shoulders: traps). */
  assistRegions: readonly RegionKey[];
  /** The training-level muscle groups (`exercise_library.muscle_group`) behind the area, for group filters. */
  groups: readonly MuscleGroup[];
  /** Other words for the area, lower case ("lower body", "belly"). The key and the label always work too. */
  aliases: readonly string[];
  /** The side of the body its mini map shows. */
  badgeView: "front" | "back";
  photo: FocusPhoto;
};

const ALL_REGIONS: readonly RegionKey[] = [...BODY_REGIONS];

export const FOCUS_AREA_INFO: Readonly<Record<FocusArea, FocusAreaInfo>> = {
  full_body: {
    key: "full_body", label: "Full body", description: "Upper and lower body together",
    regions: ALL_REGIONS, assistRegions: [], groups: ["full_body"],
    aliases: ["full body", "whole body", "total body"], badgeView: "front",
    photo: { exerciseId: "free-exercise-db-Clean_and_Press", sourceRef: "Clean_and_Press", frame: 1, position: "50% 40%" },
  },
  chest: {
    key: "chest", label: "Chest", description: "Your chest (pectorals)",
    regions: ["chest"], assistRegions: [], groups: ["chest"],
    aliases: ["pecs", "pectorals"], badgeView: "front",
    photo: { exerciseId: "push_up", sourceRef: "Pushups", frame: 1, position: "50% 55%" },
  },
  back: {
    key: "back", label: "Back", description: "Lats, upper back, lower back and traps",
    regions: ["traps", "lats", "middle_back", "lower_back"], assistRegions: [], groups: ["back"],
    aliases: [], badgeView: "back",
    photo: { exerciseId: "pull_up", sourceRef: "Pullups", frame: 1, position: "50% 35%" },
  },
  shoulders: {
    key: "shoulders", label: "Shoulders", description: "Shoulders, with some trap work",
    regions: ["shoulders"], assistRegions: ["traps"], groups: ["shoulders"],
    aliases: ["shoulder", "delts", "deltoids"], badgeView: "front",
    photo: { exerciseId: "free-exercise-db-Standing_Military_Press", sourceRef: "Standing_Military_Press", frame: 1, position: "50% 30%" },
  },
  arms: {
    key: "arms", label: "Arms", description: "Biceps, triceps and forearms",
    regions: ["biceps", "triceps", "forearms"], assistRegions: [], groups: ["biceps", "triceps", "forearms"],
    aliases: ["arm"], badgeView: "front",
    photo: { exerciseId: "free-exercise-db-Barbell_Curl", sourceRef: "Barbell_Curl", frame: 1, position: "50% 40%" },
  },
  abs: {
    key: "abs", label: "Abs", description: "Your abdominals",
    regions: ["abdominals"], assistRegions: [], groups: ["core"],
    aliases: ["ab", "belly", "core", "abdominals", "stomach"], badgeView: "front",
    photo: { exerciseId: "free-exercise-db-Crunches", sourceRef: "Crunches", frame: 1, position: "50% 50%" },
  },
  legs: {
    key: "legs", label: "Legs", description: "Quads, hamstrings, calves, inner and outer thighs",
    regions: ["quadriceps", "hamstrings", "calves", "adductors", "abductors"], assistRegions: [], groups: ["quadriceps", "hamstrings", "calves", "hips"],
    aliases: ["leg", "lower body", "thigh", "thighs"], badgeView: "front",
    photo: { exerciseId: "barbell_back_squat", sourceRef: "Barbell_Squat", frame: 1, position: "50% 55%" },
  },
  glutes: {
    key: "glutes", label: "Glutes", description: "Your glutes",
    regions: ["glutes"], assistRegions: [], groups: ["glutes"],
    aliases: ["glute", "butt", "bum", "butt and thigh"], badgeView: "back",
    photo: { exerciseId: "hip_thrust", sourceRef: "Barbell_Hip_Thrust", frame: 1, position: "50% 55%" },
  },
};

const AREA_SET: ReadonlySet<string> = new Set(FOCUS_AREAS);

export function isFocusArea(value: unknown): value is FocusArea {
  return typeof value === "string" && AREA_SET.has(value);
}

export function focusLabel(area: FocusArea): string {
  return FOCUS_AREA_INFO[area].label;
}

/** The pinned Free Exercise DB photo of an area's tile. */
export function focusPhotoUrl(area: FocusArea): string {
  const { sourceRef, frame } = FOCUS_AREA_INFO[area].photo;
  return pinnedPhotoUrl(sourceRef, frame);
}

/** Areas as a phrase for headings and sentences: "Chest and arms", "Full body, back and glutes". */
export function listFocusAreas(areas: readonly FocusArea[]): string {
  const names = normaliseFocusAreas(areas).map((area, index) => (index === 0 ? focusLabel(area) : focusLabel(area).toLowerCase()));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------- words and the ?focus= parameter

/** Lower case, "_" and "-" as spaces, "&" as "and", single spaces: "Butt_&_Thigh " → "butt and thigh". */
function normaliseWord(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim();
}

const WORDS = new Map<string, FocusArea>();
for (const area of FOCUS_AREAS) {
  const info = FOCUS_AREA_INFO[area];
  for (const word of [area, info.label, ...info.aliases]) {
    const key = normaliseWord(word);
    if (!WORDS.has(key)) WORDS.set(key, area);
  }
}

/** The area a word names: a key, a label or an alias, in any case ("Lower body" → legs); null otherwise. */
export function focusAreaFor(word: string): FocusArea | null {
  if (typeof word !== "string") return null;
  return WORDS.get(normaliseWord(word)) ?? null;
}

/** Known areas from keys or words, without repeats, in display order. Unknown values are dropped. */
export function normaliseFocusAreas(values: Iterable<string>): FocusArea[] {
  const found = new Set<FocusArea>();
  for (const value of values) {
    const area = focusAreaFor(value);
    if (area) found.add(area);
  }
  return FOCUS_AREAS.filter((area) => found.has(area));
}

/** At most this many comma-separated values are read from one parameter. */
const MAX_PARAM_VALUES = 24;

/**
 * Reads `?focus=` (one comma list, or several values from URLSearchParams.getAll): "chest,arms",
 * "Lower body", "abs,core" → areas in display order without repeats. Unknown words are ignored.
 */
export function parseFocusParam(value: string | readonly string[] | null | undefined): FocusArea[] {
  if (value == null) return [];
  const values = (typeof value === "string" ? [value] : [...value])
    .filter((item): item is string => typeof item === "string")
    .flatMap((item) => item.split(","))
    .slice(0, MAX_PARAM_VALUES);
  return normaliseFocusAreas(values);
}

/** The `?focus=` value for areas: keys in display order, comma separated; "" for none. */
export function formatFocusParam(areas: readonly string[]): string {
  return normaliseFocusAreas(areas).join(",");
}

// ---------------------------------------------------------------- exercises

/** The fields of a catalogue exercise the focus rules read. */
export type FocusExercise = Pick<CatalogExercise, "primary_muscle" | "secondary_muscles" | "muscle_group" | "category" | "mechanic">;

/** Categories that count as full body whatever their muscles: whole-body lifts and carries. */
export const FULL_BODY_CATEGORIES: readonly ExerciseCategory[] = ["olympic", "strongman"];
/**
 * Upper- and lower-body regions for the full-body rule. Grip (forearms) and the neck alone do not make a lift
 * full body, and the trunk (abdominals, lower back) belongs to neither half.
 */
const UPPER_BODY: ReadonlySet<RegionKey> = new Set(["traps", "shoulders", "chest", "biceps", "triceps", "lats", "middle_back"]);
const LOWER_BODY: ReadonlySet<RegionKey> = new Set(["glutes", "quadriceps", "hamstrings", "calves", "adductors", "abductors"]);
/** The starter rows' generic "back" can mean the upper or the lower back, so it places a lift in neither half. */
const UNPLACED_WORDS: ReadonlySet<string> = new Set(["back"]);

/**
 * The catalogue's full-body rule: its full_body group, the olympic and strongman categories, and compound
 * movements whose primary and secondary muscles reach both the upper and the lower body.
 */
export function isFullBodyExercise(exercise: FocusExercise): boolean {
  if (exercise.muscle_group === "full_body") return true;
  if (FULL_BODY_CATEGORIES.includes(exercise.category)) return true;
  if (exercise.mechanic !== "compound") return false;
  const regions = [exercise.primary_muscle, ...(exercise.secondary_muscles ?? [])]
    .filter((muscle) => typeof muscle === "string" && !UNPLACED_WORDS.has(muscle.trim().toLowerCase()))
    .flatMap(regionsForMuscle);
  return regions.some((region) => UPPER_BODY.has(region)) && regions.some((region) => LOWER_BODY.has(region));
}

export type FocusRole = "primary" | "secondary";

/** How an exercise trains an area: as its primary muscle, as a secondary one, or not at all (null). */
export function focusRole(exercise: FocusExercise, area: FocusArea): FocusRole | null {
  if (area === "full_body") return isFullBodyExercise(exercise) ? "primary" : null;
  const info = FOCUS_AREA_INFO[area];
  const { primary, secondary } = exerciseRegions(exercise.primary_muscle, exercise.secondary_muscles);
  if (primary.some((region) => info.regions.includes(region))) return "primary";
  if (primary.some((region) => info.assistRegions.includes(region))) return "secondary";
  if (secondary.some((region) => info.regions.includes(region) || info.assistRegions.includes(region))) return "secondary";
  return null;
}

/**
 * True when the exercise trains the area as its primary muscle (full body: the full-body rule). With
 * `includeSecondary`, an exercise that works the area as a secondary muscle matches too (a second tier).
 */
export function exerciseMatchesFocus(exercise: FocusExercise, area: FocusArea, options: { includeSecondary?: boolean } = {}): boolean {
  const role = focusRole(exercise, area);
  return role === "primary" || (role === "secondary" && Boolean(options.includeSecondary));
}

export const FOCUS_PRIMARY_SCORE = 2;
export const FOCUS_SECONDARY_SCORE = 1;

/** For ranking: 2 for each area the exercise trains as its primary muscle, 1 for each it works as a secondary one. */
export function focusScore(exercise: FocusExercise, areas: FocusArea | readonly FocusArea[]): number {
  const list = typeof areas === "string" ? [areas] : areas;
  let score = 0;
  for (const area of new Set(list)) {
    const role = focusRole(exercise, area);
    if (role === "primary") score += FOCUS_PRIMARY_SCORE;
    else if (role === "secondary") score += FOCUS_SECONDARY_SCORE;
  }
  return score;
}

/** The regions to highlight for a selection: the areas' regions as primary, their assist regions as secondary. */
export function focusRegions(areas: readonly FocusArea[]): { primary: RegionKey[]; secondary: RegionKey[] } {
  const chosen = normaliseFocusAreas(areas);
  const primary = new Set<RegionKey>(chosen.flatMap((area) => FOCUS_AREA_INFO[area].regions));
  const secondary = new Set<RegionKey>(chosen.flatMap((area) => FOCUS_AREA_INFO[area].assistRegions).filter((region) => !primary.has(region)));
  return { primary: BODY_REGIONS.filter((region) => primary.has(region)), secondary: BODY_REGIONS.filter((region) => secondary.has(region)) };
}

/** The areas that train a region (full body aside): lats → back; traps → back (and shoulders as an assist). */
export function focusAreasForRegion(region: RegionKey): FocusArea[] {
  return FOCUS_AREAS.filter((area) => area !== "full_body" && FOCUS_AREA_INFO[area].regions.includes(region));
}

/**
 * The one line both Workouts and the Exercise library show beside their area counts, so "you can do" reads the same
 * on both (bug 52): main muscle only, with the equipment for that place.
 */
export const FOCUS_COUNT_NOTE = "Counts include only exercises that work the area as their main muscle.";

export type FocusCount = {
  /** Active catalogue exercises that train the area as their primary muscle (full body: the rule). */
  total: number;
  /** How many of those the equipment allows; null when no equipment list was given. */
  doable: number | null;
};

/** Real counts per area from a loaded catalogue, for tile and chip captions ("85 exercises · 41 at home"). */
export function focusCounts(catalog: readonly CatalogExercise[], owned?: ReadonlySet<string> | null): Record<FocusArea, FocusCount> {
  const counts = Object.fromEntries(FOCUS_AREAS.map((area) => [area, { total: 0, doable: owned ? 0 : null }])) as Record<FocusArea, FocusCount>;
  for (const exercise of catalog) {
    const doable = owned ? isDoableWith(exercise.required_equipment, owned) : false;
    for (const area of FOCUS_AREAS) {
      if (!exerciseMatchesFocus(exercise, area)) continue;
      counts[area].total += 1;
      if (doable) counts[area].doable = (counts[area].doable ?? 0) + 1;
    }
  }
  return counts;
}

export type RankedFocusExercise = {
  exercise: CatalogExercise;
  score: number;
  /** True when the equipment allows it (always true when no equipment list was given). */
  doable: boolean;
};

export type RankFocusOptions = {
  /** Equipment the user has, expanded (expandOwnedEquipment); doable exercises come first. */
  owned?: ReadonlySet<string> | null;
  /** Leave out what the equipment does not allow. */
  doableOnly?: boolean;
  /** Exercises above this level come last. */
  level?: Level;
  /** Also rank exercises that only work an area as a secondary muscle (score 1). Default true. */
  includeSecondary?: boolean;
  limit?: number;
};

/**
 * Exercises for the chosen areas, best first: doable with the equipment, then the focus score (exercises
 * that train several chosen areas first), then FITX staples, then those at or below the user's level,
 * compound before isolation, then by name. Stretches are left out. Deterministic.
 */
export function rankFocusExercises(catalog: readonly CatalogExercise[], areas: readonly FocusArea[], options: RankFocusOptions = {}): RankedFocusExercise[] {
  const chosen = normaliseFocusAreas(areas);
  if (!chosen.length) return [];
  const includeSecondary = options.includeSecondary ?? true;
  const userLevel = options.level ? levelRank(options.level) : null;
  const ranked: Array<RankedFocusExercise & { primary: boolean; staple: number; levelGap: number }> = [];
  for (const exercise of catalog) {
    if (exercise.category === "stretching") continue;
    let score = 0;
    let primary = false;
    for (const area of chosen) {
      const role = focusRole(exercise, area);
      if (role === "primary") { score += FOCUS_PRIMARY_SCORE; primary = true; }
      else if (role === "secondary" && includeSecondary) score += FOCUS_SECONDARY_SCORE;
    }
    if (score === 0) continue;
    const doable = options.owned ? isDoableWith(exercise.required_equipment, options.owned) : true;
    if (options.doableOnly && !doable) continue;
    ranked.push({
      exercise, score, doable, primary,
      staple: stapleRank(exercise.id) ?? Number.POSITIVE_INFINITY,
      levelGap: userLevel === null ? 0 : Math.max(0, levelRank(exercise.difficulty) - userLevel),
    });
  }
  ranked.sort((a, b) =>
    Number(b.doable) - Number(a.doable)
    || Number(b.primary) - Number(a.primary)
    || b.score - a.score
    || a.levelGap - b.levelGap
    || a.staple - b.staple
    || Number(b.exercise.mechanic === "compound") - Number(a.exercise.mechanic === "compound")
    || a.exercise.name.localeCompare(b.exercise.name)
    || a.exercise.id.localeCompare(b.exercise.id));
  const list = ranked.map(({ exercise, score, doable }) => ({ exercise, score, doable }));
  return options.limit === undefined ? list : list.slice(0, Math.max(0, options.limit));
}
