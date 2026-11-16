import { DEFAULT_GYM_EQUIPMENT, EQUIPMENT, EQUIPMENT_COVERS, NO_EQUIPMENT_WORDS, type TrainingContext } from "./taxonomy";

/** Lower-case, single-spaced, with `_` and `-` read as spaces: "Pull-Up_Bar " -> "pull up bar". */
export function normalizeEquipmentWord(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

const SYNONYMS = new Map<string, string>();
for (const item of EQUIPMENT) {
  for (const word of [item.key, item.label, ...item.synonyms]) SYNONYMS.set(normalizeEquipmentWord(word), item.key);
}
const NO_EQUIPMENT = new Set(NO_EQUIPMENT_WORDS.map(normalizeEquipmentWord));
const ORDER = new Map(EQUIPMENT.map((item, index) => [item.key, index]));

/**
 * The equipment key for a word from older data or free text ("Dumbbells", "resistance bands"),
 * "" for words meaning no equipment ("bodyweight"), or null when it is not recognised.
 */
export function equipmentKeyFor(value: string): string | null {
  const word = normalizeEquipmentWord(value);
  if (!word) return null;
  if (NO_EQUIPMENT.has(word)) return "";
  return SYNONYMS.get(word) ?? (word.endsWith("s") ? SYNONYMS.get(word.slice(0, -1)) ?? null : null);
}

/** Known keys, de-duplicated, in the catalogue's display order. */
export function sortEquipmentKeys(keys: Iterable<string>): string[] {
  return [...new Set(keys)].filter((key) => ORDER.has(key)).sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
}

/** Older equipment words (onboarding tags, Profile's free text) as keys; unknown words are dropped. */
export function equipmentKeysFromWords(words: readonly string[] | null | undefined): string[] {
  return sortEquipmentKeys((words ?? []).map(equipmentKeyFor).filter((key): key is string => Boolean(key)));
}

/** What the user owns plus what those items also serve as (a bench works as a step). */
export function expandOwnedEquipment(owned: Iterable<string>): Set<string> {
  const expanded = new Set<string>();
  for (const key of owned) {
    expanded.add(key);
    for (const covered of EQUIPMENT_COVERS[key] ?? []) expanded.add(covered);
  }
  return expanded;
}

/** Required keys the user does not have (empty when the exercise is doable). */
export function missingEquipment(required: readonly string[], owned: ReadonlySet<string>): string[] {
  return required.filter((key) => !owned.has(key));
}

export function isDoableWith(required: readonly string[], owned: ReadonlySet<string>): boolean {
  return required.every((key) => owned.has(key));
}

export function equipmentLabel(key: string): string {
  return EQUIPMENT.find((item) => item.key === key)?.label ?? key.replaceAll("_", " ");
}

/**
 * A starting list before the user has saved one: at home, what they picked in onboarding or
 * Profile (often nothing); at a gym, a full commercial gym.
 */
export function defaultEquipmentFor(context: TrainingContext, legacyWords?: readonly string[] | null): string[] {
  return context === "gym" ? [...DEFAULT_GYM_EQUIPMENT] : equipmentKeysFromWords(legacyWords);
}
