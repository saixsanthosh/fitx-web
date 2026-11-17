/**
 * The muscle regions of the FITX body map and the helpers that turn catalogue muscles and logged sets into
 * per-region numbers. Pure: it imports only the taxonomy and holds no data beyond the vocabulary; every
 * number it returns is derived from what the caller passes in.
 *
 * Region keys are stable identifiers and equal the catalogue's `exercise_library.primary_muscle` values
 * (taxonomy.ts MUSCLE_TO_GROUP), so a primary muscle is usually its own region. `regionsForMuscle` also reads
 * the older starter vocabulary found in `secondary_muscles` (front_deltoids, rear_deltoids, upper_chest, core,
 * back, hip_flexors, ankles) and common spellings ("Lower back", "lower-back", "quads").
 * Note: taxonomy.ts also exports a BODY_REGIONS (the split-day regions); import one of them under another name
 * when a file needs both.
 */
import { MUSCLE_GROUPS, MUSCLE_TO_GROUP, type MuscleGroup } from "./taxonomy";

/** Drawn regions, top to bottom. Add keys; never rename or reuse one. */
export const BODY_REGIONS = [
  "neck", "traps", "shoulders", "chest", "biceps", "triceps", "forearms", "lats", "middle_back", "lower_back",
  "abdominals", "abductors", "adductors", "glutes", "quadriceps", "hamstrings", "calves",
] as const;
export type RegionKey = (typeof BODY_REGIONS)[number];

/** Which side of the figure a region is drawn on. */
export type RegionViews = "front" | "back" | "both";

export type RegionInfo = {
  key: RegionKey;
  /** Display name, sentence case ("Lower back"). */
  label: string;
  views: RegionViews;
  group: MuscleGroup;
};

export const REGIONS: Readonly<Record<RegionKey, RegionInfo>> = {
  neck: { key: "neck", label: "Neck", views: "front", group: "neck" },
  traps: { key: "traps", label: "Traps", views: "both", group: "back" },
  shoulders: { key: "shoulders", label: "Shoulders", views: "both", group: "shoulders" },
  chest: { key: "chest", label: "Chest", views: "front", group: "chest" },
  biceps: { key: "biceps", label: "Biceps", views: "front", group: "biceps" },
  triceps: { key: "triceps", label: "Triceps", views: "back", group: "triceps" },
  forearms: { key: "forearms", label: "Forearms", views: "both", group: "forearms" },
  lats: { key: "lats", label: "Lats", views: "both", group: "back" },
  middle_back: { key: "middle_back", label: "Middle back", views: "back", group: "back" },
  lower_back: { key: "lower_back", label: "Lower back", views: "back", group: "back" },
  abdominals: { key: "abdominals", label: "Abdominals", views: "front", group: "core" },
  abductors: { key: "abductors", label: "Abductors", views: "both", group: "hips" },
  adductors: { key: "adductors", label: "Adductors", views: "both", group: "hips" },
  glutes: { key: "glutes", label: "Glutes", views: "back", group: "glutes" },
  quadriceps: { key: "quadriceps", label: "Quadriceps", views: "front", group: "quadriceps" },
  hamstrings: { key: "hamstrings", label: "Hamstrings", views: "back", group: "hamstrings" },
  calves: { key: "calves", label: "Calves", views: "both", group: "calves" },
};

const REGION_SET: ReadonlySet<string> = new Set(BODY_REGIONS);

export function isRegionKey(value: unknown): value is RegionKey {
  return typeof value === "string" && REGION_SET.has(value);
}

export function regionLabel(region: RegionKey): string {
  return REGIONS[region].label;
}

/** Whether a region is drawn on the given side of the figure. */
export function regionInView(region: RegionKey, view: "front" | "back"): boolean {
  const views = REGIONS[region].views;
  return views === "both" || views === view;
}

export function groupForRegion(region: RegionKey): MuscleGroup {
  return REGIONS[region].group;
}

const GROUP_REGIONS = new Map<MuscleGroup, readonly RegionKey[]>(
  MUSCLE_GROUPS.map((group) => [group, BODY_REGIONS.filter((key) => REGIONS[key].group === group)]),
);

/** The regions of a training-level muscle group (back → traps, lats, middle back, lower back); full_body → []. */
export function regionsForGroup(group: MuscleGroup): RegionKey[] {
  return [...(GROUP_REGIONS.get(group) ?? [])];
}

/** Other words for a region: the starter catalogue's secondary muscles, singulars and everyday names. */
const ALIASES = new Map<string, readonly RegionKey[]>([
  ["sternocleidomastoid", ["neck"]],
  ["trap", ["traps"]], ["trapezius", ["traps"]], ["upper_traps", ["traps"]],
  ["shoulder", ["shoulders"]], ["delts", ["shoulders"]], ["deltoids", ["shoulders"]], ["front_deltoids", ["shoulders"]],
  ["side_deltoids", ["shoulders"]], ["lateral_deltoids", ["shoulders"]], ["rear_deltoids", ["shoulders"]],
  ["front_delts", ["shoulders"]], ["side_delts", ["shoulders"]], ["rear_delts", ["shoulders"]],
  ["pecs", ["chest"]], ["pectorals", ["chest"]], ["upper_chest", ["chest"]], ["lower_chest", ["chest"]],
  ["bicep", ["biceps"]], ["tricep", ["triceps"]], ["forearm", ["forearms"]], ["grip", ["forearms"]],
  ["lat", ["lats"]], ["latissimus_dorsi", ["lats"]],
  ["mid_back", ["middle_back"]], ["upper_back", ["middle_back"]], ["rhomboids", ["middle_back"]],
  ["erectors", ["lower_back"]], ["spinal_erectors", ["lower_back"]], ["erector_spinae", ["lower_back"]],
  ["abs", ["abdominals"]], ["obliques", ["abdominals"]], ["rectus_abdominis", ["abdominals"]],
  ["abductor", ["abductors"]], ["hip_abductors", ["abductors"]], ["outer_thigh", ["abductors"]],
  ["adductor", ["adductors"]], ["hip_adductors", ["adductors"]], ["inner_thigh", ["adductors"]], ["groin", ["adductors"]],
  ["glute", ["glutes"]], ["gluteus", ["glutes"]], ["buttocks", ["glutes"]],
  ["quads", ["quadriceps"]], ["quad", ["quadriceps"]],
  // The rectus femoris, the most visible hip flexor, is drawn as part of the quadriceps.
  ["hip_flexors", ["quadriceps"]], ["hip_flexor", ["quadriceps"]],
  ["hamstring", ["hamstrings"]], ["hams", ["hamstrings"]],
  ["calf", ["calves"]], ["ankles", ["calves"]], ["soleus", ["calves"]], ["gastrocnemius", ["calves"]],
]);

const normalise = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, "_");

/**
 * The regions a catalogue muscle value covers, ignoring case, spaces, hyphens and underscores
 * ("Lower back" → lower_back). A group word covers its regions ("back", "core", "hips"); "cardio" and
 * anything unknown cover none.
 */
export function regionsForMuscle(muscle: string): RegionKey[] {
  if (typeof muscle !== "string") return [];
  const key = normalise(muscle);
  if (isRegionKey(key)) return [key];
  const alias = ALIASES.get(key);
  if (alias) return [...alias];
  if (Object.hasOwn(MUSCLE_TO_GROUP, key)) return regionsForGroup(MUSCLE_TO_GROUP[key]);
  if ((MUSCLE_GROUPS as readonly string[]).includes(key)) return regionsForGroup(key as MuscleGroup);
  return [];
}

/**
 * An exercise's primary and secondary regions for a two-tone map. A region counts once, at its highest role:
 * secondary regions never repeat a primary one.
 */
export function exerciseRegions(primary: string | null | undefined, secondary?: readonly string[] | null): { primary: RegionKey[]; secondary: RegionKey[] } {
  const primaryRegions = primary ? regionsForMuscle(primary) : [];
  const taken = new Set<RegionKey>(primaryRegions);
  const secondaryRegions: RegionKey[] = [];
  for (const muscle of secondary ?? []) {
    for (const region of regionsForMuscle(muscle)) {
      if (taken.has(region)) continue;
      taken.add(region);
      secondaryRegions.push(region);
    }
  }
  return { primary: primaryRegions, secondary: secondaryRegions };
}

// ---------------------------------------------------------------- training load

/** Credit per completed set: the primary muscle gets a whole set, each secondary muscle half. */
export const PRIMARY_SET_CREDIT = 1;
export const SECONDARY_SET_CREDIT = 0.5;

export type MuscleLoadEntry = {
  primary: string | null;
  secondary?: readonly string[] | null;
  /** Completed sets of this exercise. Anything not a positive finite number counts as none. */
  sets: number;
};

export type RegionNumbers = Record<RegionKey, number>;

/** Every region at 0. */
export function emptyRegionNumbers(): RegionNumbers {
  return Object.fromEntries(BODY_REGIONS.map((key) => [key, 0])) as RegionNumbers;
}

/**
 * Completed sets per region: 1 per set for the regions of the primary muscle, 0.5 per set for the regions of
 * each secondary muscle. Within one entry a region counts once, at its highest role (a secondary muscle that
 * repeats the primary adds nothing). Unknown muscles are ignored. With whole sets every result is a multiple
 * of 0.5, so it is exact.
 */
export function muscleLoad(entries: readonly MuscleLoadEntry[]): RegionNumbers {
  const load = emptyRegionNumbers();
  for (const entry of entries) {
    const sets = Number.isFinite(entry.sets) && entry.sets > 0 ? entry.sets : 0;
    if (sets === 0) continue;
    const { primary, secondary } = exerciseRegions(entry.primary, entry.secondary);
    for (const region of primary) load[region] += PRIMARY_SET_CREDIT * sets;
    for (const region of secondary) load[region] += SECONDARY_SET_CREDIT * sets;
  }
  return load;
}

const positive = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** Each region's share of the total, in percent (0–100; they add up to 100 when there is any load). */
export function loadShare(load: Readonly<Partial<Record<RegionKey, number>>>): RegionNumbers {
  const total = BODY_REGIONS.reduce((sum, key) => sum + positive(load[key]), 0);
  const share = emptyRegionNumbers();
  if (total === 0) return share;
  for (const key of BODY_REGIONS) share[key] = (positive(load[key]) * 100) / total;
  return share;
}

/** Each region relative to the most-loaded one: 0..1, where the busiest region is 1 (all 0 when there is no load). */
export function loadLevels(load: Readonly<Partial<Record<RegionKey, number>>>): RegionNumbers {
  const max = BODY_REGIONS.reduce((most, key) => Math.max(most, positive(load[key])), 0);
  const levels = emptyRegionNumbers();
  if (max === 0) return levels;
  for (const key of BODY_REGIONS) levels[key] = positive(load[key]) / max;
  return levels;
}

/** Region names as a phrase for labels and sentences: "chest, shoulders and triceps". */
export function listRegions(regions: readonly RegionKey[]): string {
  const names = regions.map((key) => REGIONS[key].label.toLowerCase());
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
