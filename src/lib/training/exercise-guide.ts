/**
 * How the exercise page shows the catalogue's own words. Data-integrity rule: only sourced text, so nothing here
 * writes coaching text. Pure.
 *
 * Steps are `exercise_library.instructions`: Free Exercise DB text for the imported exercises, FITX's own for the
 * 30 starters. They are tidied for display only:
 *  - runs of white space become one space, and a space missing after a full stop is put back ("torso.This");
 *  - leftover HTML list markup is removed ("li>", "<li>");
 *  - a step that repeats its own number ("6. Repeat…" as step 6) loses the repeat, since the list numbers it.
 * Each step is then split into its first sentence and the rest, so a long step can be scanned. No other word is
 * added, dropped or changed: tests/training/exercise-guide.test.ts checks every step in the catalogue.
 *
 * The muscle lists use the catalogue's muscle words and the body map's regions (anatomy.ts).
 */
import { isBroadMuscleWord, regionsForMuscle, type RegionKey } from "./anatomy";

export type GuideStep = {
  /** 1-based, as shown. */
  number: number;
  /** The tidied step. */
  text: string;
  /** Its first sentence. */
  lead: string;
  /** The rest of the step ("" when it is one sentence). lead + " " + rest === text. */
  rest: string;
};

/** Steps longer than this are shown folded: the first STEPS_PREVIEW, then "Show all". */
export const STEPS_FOLD_AFTER = 8;
export const STEPS_PREVIEW = 6;

const squashSpaces = (text: string) => text.replace(/\s+/g, " ").trim();

/** One catalogue step as shown: spacing, markup remnants and a repeated step number tidied; "" when nothing is left. */
export function tidyStep(step: string, number: number): string {
  if (typeof step !== "string") return "";
  const withoutMarkup = step
    .replace(/<\/?(?:li|ul|ol|p|br)\b[^>]*>/gi, " ")
    .replace(/(^|\s)\/?li>(?=\s|$)/gi, "$1");
  const spaced = squashSpaces(withoutMarkup).replace(/([a-z]{2}[.!?])([A-Z][a-z])/g, "$1 $2");
  return spaced.replace(new RegExp(`^${number}[.)]\\s+`), "").trim();
}

// A sentence ends at . ! or ? (and any closing quote or bracket), before white space and a capital, a digit or an
// opening quote or bracket.
const BOUNDARY = /[.!?]["'’”)\]]*\s+(?=["'‘“(]?[A-Z0-9])/g;
/** Shorter "sentences" are not split off (a lone number or initial). */
const MIN_LEAD = 4;

/** A step's first sentence and the rest, with nothing lost: lead + " " + rest is the step. */
export function splitStep(text: string): { lead: string; rest: string } {
  for (const match of text.matchAll(BOUNDARY)) {
    const leadEnd = match.index + match[0].trimEnd().length;
    const lead = text.slice(0, leadEnd);
    if (lead.length < MIN_LEAD) continue;
    const rest = text.slice(match.index + match[0].length);
    return rest ? { lead, rest } : { lead: text, rest: "" };
  }
  return { lead: text, rest: "" };
}

/** The steps to show, numbered from 1; empty steps are left out. */
export function guideSteps(instructions: readonly string[] | null | undefined): GuideStep[] {
  const steps: GuideStep[] = [];
  for (const raw of instructions ?? []) {
    const number = steps.length + 1;
    const text = tidyStep(raw, number);
    if (!text) continue;
    steps.push({ number, text, ...splitStep(text) });
  }
  return steps;
}

/** How many steps to show: all of a short list, the first STEPS_PREVIEW of a long one until it is expanded. */
export function visibleStepCount(count: number, expanded: boolean): number {
  return expanded || count <= STEPS_FOLD_AFTER ? count : STEPS_PREVIEW;
}

const comparable = (text: string) => squashSpaces(text).toLowerCase();

/**
 * The catalogue description to show under the name, or null. Imported exercises repeat their first step as the
 * description, so it is shown only when it says something the steps do not start with.
 */
export function shownDescription(description: string | null | undefined, instructions: readonly string[] | null | undefined): string | null {
  const text = typeof description === "string" ? squashSpaces(description) : "";
  if (!text) return null;
  const first = (instructions ?? []).find((step) => typeof step === "string" && step.trim());
  return first && comparable(first) === comparable(text) ? null : text;
}

/** A catalogue muscle value as words: "lower_back" -> "lower back". */
export function muscleWords(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/** "a", "a and b", "a, b and c". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function uniqueMuscles(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const word = muscleWords(value);
    if (seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

/** Assisting muscles named in the one-line summary; the Muscles tab lists them all. */
export const SUMMARY_ASSISTING = 3;

/**
 * One line about the muscles, from the catalogue's own muscle fields: "Works the hamstrings, with the glutes and
 * lower back assisting." At most SUMMARY_ASSISTING assisting muscles are named, then "and N more". Null when the
 * primary muscle is not one the body map knows (for example "cardio").
 */
export function muscleSummary(primary: string | null | undefined, secondary: readonly string[] | null | undefined): string | null {
  if (!primary || !regionsForMuscle(primary).length) return null;
  const main = muscleWords(primary);
  // A broad assisting word (the starter rows' "back" on a hip hinge) names no one muscle, as on the map.
  const others = uniqueMuscles(secondary ?? []).filter((word) => word !== main && regionsForMuscle(word).length > 0 && !isBroadMuscleWord(word));
  const named = others.length > SUMMARY_ASSISTING ? [...others.slice(0, SUMMARY_ASSISTING), `${others.length - SUMMARY_ASSISTING} more`] : others;
  return `Works the ${main}${named.length ? `, with the ${listWords(named)} assisting` : ""}.`;
}

export type MuscleRow = {
  /** The catalogue's muscle, as words ("front deltoids"). */
  name: string;
  /** The body-map regions it covers that no row above already covers. */
  regions: RegionKey[];
  /** The muscle is itself one region (its name can link straight to it). */
  direct: boolean;
};

export type MuscleRows = {
  primary: MuscleRow[];
  assisting: MuscleRow[];
  /** Catalogue muscles the body map does not draw (for example "cardio"). */
  notDrawn: string[];
};

/**
 * The primary and assisting muscles as listed in the catalogue, each with the body-map regions it covers. A
 * region is listed once, at its highest role, as on the map (exerciseRegions); an assisting muscle whose regions
 * are all listed already is left out. A broad assisting word (isBroadMuscleWord, such as "back") is listed as not
 * drawn: the map credits no region for it rather than all of them.
 */
export function muscleRows(primary: string | null | undefined, secondary: readonly string[] | null | undefined): MuscleRows {
  const taken = new Set<RegionKey>();
  const rows: MuscleRows = { primary: [], assisting: [], notDrawn: [] };
  const words = uniqueMuscles([primary, ...(secondary ?? [])]);
  const primaryWord = primary && primary.trim() ? muscleWords(primary) : null;
  for (const word of words) {
    const all = regionsForMuscle(word);
    if (!all.length || (word !== primaryWord && isBroadMuscleWord(word))) {
      rows.notDrawn.push(word);
      continue;
    }
    const regions = all.filter((region) => !taken.has(region));
    for (const region of regions) taken.add(region);
    const isPrimary = word === primaryWord;
    if (!isPrimary && !regions.length) continue;
    const row: MuscleRow = { name: word, regions, direct: regions.length === 1 && regions[0] === word.replace(/ /g, "_") };
    (isPrimary ? rows.primary : rows.assisting).push(row);
  }
  return rows;
}
