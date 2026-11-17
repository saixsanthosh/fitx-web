/**
 * Smart search for exercise names: how typed words become a search plan, and how a plan matches and scores a
 * catalogue exercise. Pure (vocabularies and string work only), so the exercise library, GET /api/exercises
 * (through catalog-search.ts) and node tests share one behaviour.
 *
 * What a search understands:
 *  - spelling variants: case, accents, hyphens and other punctuation ("Push-Up" = "push up"), joined words
 *    ("pushup", "benchpress", "latpulldown") and plurals or other endings ("curls", "flyes", "presses", "calves");
 *  - partial words: a typed word may be the start of a word in the name ("benc pre" finds Bench Press);
 *  - gym terms and abbreviations (TERM_CLASSES): bp, ohp, rdl, press-up, skull crusher, ...: a synonym scores a
 *    little below the words the member typed, so literal matches come first;
 *  - muscle words (MUSCLE_TERMS: pecs, lats, quads, hammies, glutes, delts, abs, traps, obliques, ...): the name has
 *    the word, or the catalogue lists the muscle (as the primary muscle above as an assisting one);
 *  - equipment words (EQUIPMENT_TERMS: db, bb, kb, cable, band, bodyweight, ...): the name has the word, or the
 *    exercise needs that equipment.
 * Every term of a search must match (AND); any alternative of a term may (OR). Small linking words ("and",
 * "with") never stop a match.
 */
import { exerciseRegions, type RegionKey } from "./anatomy";

// ---------------------------------------------------------------- text

/** One word: letters (any script, with their marks) and digits, keeping an inner apostrophe ("Farmer's"). */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
const COMBINING = /\p{M}+/gu;
const APOSTROPHES = /['’]/g;

/** Words a search never has to find: they only link the others. (Single letters are kept: "t bar row", "a_b".) */
export const STOP_WORDS: ReadonlySet<string> = new Set(["and", "the", "of", "on", "with", "to", "for", "in", "at"]);

/** Endings folded to one form on both sides of a match. */
const IRREGULAR = new Map<string, string>([
  ["flyes", "fly"], ["flye", "fly"], ["flies", "fly"], ["calves", "calf"], ["halves", "half"], ["knives", "knife"],
  ["shelves", "shelf"], ["feet", "foot"], ["teeth", "tooth"],
]);

/**
 * One word in its folded form, the same for the name and the search: lower case, accents and apostrophes removed,
 * and a plural or similar ending dropped ("Curls" → "curl", "Presses" → "press", "Hammies" → "hammy",
 * "Push-Ups" gives "push" and "up"). Words that only look plural ("press", "abs", "biceps") fold consistently.
 */
export function foldWord(word: string): string {
  const plain = word.normalize("NFKD").replace(COMBINING, "").replace(APOSTROPHES, "").toLowerCase();
  const irregular = IRREGULAR.get(plain);
  if (irregular) return irregular;
  if (plain.length > 4 && plain.endsWith("ies")) return `${plain.slice(0, -3)}y`;
  if (plain.length > 4 && /(?:ches|shes|sses|xes|zzes)$/.test(plain)) return plain.slice(0, -2);
  if (plain.length >= 3 && plain.endsWith("s") && !/(?:ss|us|is)$/.test(plain)) return plain.slice(0, -1);
  return plain;
}

/** The folded words of a text, in order ("Push-Ups With Feet Elevated" → push, up, with, foot, elevated). */
export function textTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of String(text ?? "").matchAll(WORD)) {
    const token = foldWord(match[0]);
    if (token) tokens.push(token);
  }
  return tokens;
}

/** A name ready for matching: its folded words, where each sits in the original text, and the words joined. */
export type NameIndex = {
  tokens: readonly string[];
  /** [start, end) of each token in the original name, for highlighting. */
  spans: ReadonlyArray<readonly [number, number]>;
  joined: string;
};

const NAME_CACHE = new Map<string, NameIndex>();
const NAME_CACHE_LIMIT = 4000;

export function nameIndex(name: string): NameIndex {
  const cached = NAME_CACHE.get(name);
  if (cached) return cached;
  const tokens: string[] = [];
  const spans: Array<readonly [number, number]> = [];
  for (const match of String(name ?? "").matchAll(WORD)) {
    const token = foldWord(match[0]);
    if (!token) continue;
    tokens.push(token);
    spans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }
  const index: NameIndex = { tokens, spans, joined: tokens.join("") };
  if (NAME_CACHE.size >= NAME_CACHE_LIMIT) NAME_CACHE.clear();
  NAME_CACHE.set(name, index);
  return index;
}

// ---------------------------------------------------------------- vocabularies

/**
 * Gym terms that mean the same movement. Any member typed finds the others; the member typed scores highest.
 * Single words that are also ordinary name words ("bench", "row") are not listed, so they keep finding every name
 * that has them. Checked against the catalogue's real names (tests/training/search-terms.test.ts).
 */
export const TERM_CLASSES: readonly (readonly string[])[] = [
  ["bench press", "bp", "benchpress", "flat bench press"],
  ["overhead press", "ohp", "military press", "shoulder press", "strict press"],
  ["romanian deadlift", "rdl"],
  ["stiff leg deadlift", "stiff legged deadlift", "sldl"],
  ["deadlift", "dl", "conventional deadlift"],
  ["trap bar", "hex bar"],
  ["push up", "press up", "pushup", "pressup"],
  ["pull up", "chin up", "pullup", "chinup"],
  ["lat pulldown", "lat pull down", "pulldown", "pull down", "lat pull"],
  ["skull crusher", "skullcrusher", "lying triceps extension", "lying triceps press", "french press"],
  ["leg curl", "hamstring curl"],
  ["leg press"],
  ["leg extension", "quad extension"],
  ["leg raise", "hanging leg raise", "lying leg raise", "knee raise"],
  ["back squat", "barbell squat", "barbell back squat"],
  ["air squat", "bodyweight squat", "body weight squat"],
  ["split squat", "lunge", "bulgarian split squat"],
  ["reverse lunge", "back lunge", "rear lunge"],
  // Side planks first, so "side plank" keeps its own class; "plank" still finds them.
  ["side plank", "side bridge"],
  ["plank", "front plank", "forearm plank", "side plank", "side bridge"],
  ["crunch", "sit up", "situp"],
  ["ab roller", "ab wheel", "ab rollout", "rollout"],
  ["hip thrust", "glute bridge", "hip bridge", "butt lift"],
  ["glute ham raise", "ghr"],
  ["calf raise", "calf press", "heel raise"],
  ["face pull", "facepull"],
  ["fly", "chest fly", "pec fly"],
  ["pec deck", "butterfly", "machine fly"],
  ["lateral raise", "side raise", "lat raise", "side lateral raise"],
  ["rear delt fly", "reverse fly", "rear delt raise"],
  ["triceps pushdown", "pushdown", "push down", "rope pushdown"],
  ["back extension", "hyperextension", "hyper extension"],
  ["farmer walk", "farmer carry", "farmers walk", "farmers carry"],
  ["jumping jack", "star jump"],
  ["step up", "stepup"],
  ["kettlebell swing", "kb swing"],
];

/** Words for a muscle: the name may have the word, or the catalogue lists the muscle. */
export const MUSCLE_TERMS: ReadonlyArray<{ words: readonly string[]; regions: readonly RegionKey[] }> = [
  { words: ["chest", "pec", "pecs", "pectoral", "pectorals", "pectoralis"], regions: ["chest"] },
  { words: ["lat", "lats", "latissimus", "latissimus dorsi"], regions: ["lats"] },
  { words: ["quad", "quads", "quadricep", "quadriceps"], regions: ["quadriceps"] },
  { words: ["hamstring", "hamstrings", "hammy", "hammies", "hams"], regions: ["hamstrings"] },
  { words: ["glute", "glutes", "gluteus", "butt", "bum", "booty", "buttocks"], regions: ["glutes"] },
  { words: ["delt", "delts", "deltoid", "deltoids", "shoulder", "shoulders"], regions: ["shoulders"] },
  { words: ["ab", "abs", "abdominal", "abdominals", "core", "six pack", "sixpack", "stomach", "belly", "midsection", "oblique", "obliques"], regions: ["abdominals"] },
  { words: ["trap", "traps", "trapezius"], regions: ["traps"] },
  { words: ["bicep", "biceps"], regions: ["biceps"] },
  { words: ["tricep", "triceps"], regions: ["triceps"] },
  { words: ["forearm", "forearms"], regions: ["forearms"] },
  { words: ["calf", "calves"], regions: ["calves"] },
  { words: ["lower back", "erector", "erectors", "spinal erectors"], regions: ["lower_back"] },
  { words: ["middle back", "mid back", "upper back", "rhomboid", "rhomboids"], regions: ["middle_back"] },
  { words: ["back"], regions: ["traps", "lats", "middle_back", "lower_back"] },
  { words: ["neck"], regions: ["neck"] },
  { words: ["adductor", "adductors", "inner thigh", "inner thighs", "groin"], regions: ["adductors"] },
  { words: ["abductor", "abductors", "outer thigh", "outer thighs"], regions: ["abductors"] },
  { words: ["arm", "arms"], regions: ["biceps", "triceps", "forearms"] },
  { words: ["leg", "legs", "lower body", "thigh", "thighs"], regions: ["quadriceps", "hamstrings", "calves", "adductors", "abductors"] },
];

/** Words for "a whole-body movement" (catalogue rule: focus.ts isFullBodyExercise, applied by the caller). */
export const FULL_BODY_WORDS: readonly string[] = ["full body", "whole body", "total body", "fullbody"];

/** Words for equipment: the name may have the word, or the exercise needs the item ("none": needs nothing). */
export const EQUIPMENT_TERMS: ReadonlyArray<{ words: readonly string[]; keys: readonly string[] }> = [
  { words: ["dumbbell", "dumbbells", "db", "dbs", "dumbell", "dumbells", "dumbel"], keys: ["dumbbell"] },
  { words: ["barbell", "barbells", "bb", "barbel", "olympic bar"], keys: ["barbell"] },
  { words: ["kettlebell", "kettlebells", "kb", "kbs", "kettle bell", "kettelbell"], keys: ["kettlebell"] },
  { words: ["ez bar", "ezbar", "ez curl bar", "curl bar", "ez"], keys: ["ez_bar"] },
  { words: ["band", "bands", "resistance band", "resistance bands", "mini band", "loop band"], keys: ["resistance_band"] },
  { words: ["cable", "cables", "pulley", "cable machine"], keys: ["cable_machine"] },
  { words: ["machine", "machines", "leverage"], keys: ["machine", "smith_machine", "cardio_machine"] },
  { words: ["smith", "smith machine"], keys: ["smith_machine"] },
  { words: ["bodyweight", "body weight", "bw", "no equipment", "calisthenics"], keys: ["none"] },
  { words: ["pull up bar", "pullup bar", "chin up bar"], keys: ["pull_up_bar"] },
  { words: ["dip bar", "dip bars", "dip station", "parallel bars"], keys: ["dip_station"] },
  { words: ["squat rack", "power rack", "rack"], keys: ["squat_rack"] },
  { words: ["trx", "suspension", "suspension trainer", "rings", "ring"], keys: ["suspension_trainer"] },
  { words: ["medicine ball", "med ball", "slam ball"], keys: ["medicine_ball"] },
  { words: ["stability ball", "swiss ball", "exercise ball", "physio ball", "physioball", "gym ball"], keys: ["stability_ball"] },
  { words: ["foam roller", "foam roll", "roller"], keys: ["foam_roller"] },
  { words: ["jump rope", "skipping rope", "skipping"], keys: ["jump_rope"] },
  { words: ["sled", "prowler"], keys: ["sled"] },
  { words: ["box", "plyo box"], keys: ["box"] },
  { words: ["chair"], keys: ["chair"] },
];

type Entry =
  | { kind: "phrase"; members: readonly (readonly string[])[] }
  | { kind: "muscle"; words: readonly (readonly string[])[]; regions: readonly RegionKey[] }
  | { kind: "equipment"; words: readonly (readonly string[])[]; keys: readonly string[] }
  | { kind: "full_body"; words: readonly (readonly string[])[] };

const DICTIONARY = new Map<string, Entry>();
let longestEntry = 1;

function addEntry(words: readonly string[], entry: Entry) {
  for (const word of words) {
    const tokens = textTokens(word);
    if (!tokens.length) continue;
    longestEntry = Math.max(longestEntry, tokens.length);
    // The first vocabulary to claim a phrase keeps it (gym terms, then equipment, then muscles).
    for (const key of new Set([tokens.join(" "), tokens.join("")])) if (!DICTIONARY.has(key)) DICTIONARY.set(key, entry);
  }
}

for (const members of TERM_CLASSES) addEntry(members, { kind: "phrase", members: members.map(textTokens) });
for (const term of EQUIPMENT_TERMS) addEntry(term.words, { kind: "equipment", words: term.words.map(textTokens), keys: term.keys });
addEntry(FULL_BODY_WORDS, { kind: "full_body", words: FULL_BODY_WORDS.map(textTokens) });
for (const term of MUSCLE_TERMS) addEntry(term.words, { kind: "muscle", words: term.words.map(textTokens), regions: term.regions });

/** True when the folded word or phrase is in a vocabulary above. */
export function isKnownTerm(text: string): boolean {
  return DICTIONARY.has(textTokens(text).join(" "));
}

// ---------------------------------------------------------------- the plan

export type SearchTermKind = "words" | "phrase" | "muscle" | "equipment" | "full_body";

export type SearchTerm = {
  /** What the member typed for this term, folded ("ohp", "lower back", "bench pre"). */
  text: string;
  kind: SearchTermKind;
  /** Word sequences that count as the term in a name: the first is what the member typed, the rest are synonyms. */
  alternatives: ReadonlyArray<readonly string[]>;
  /** Muscle terms: the body-map regions the word names. */
  regions: readonly RegionKey[];
  /** Equipment terms: the equipment keys ("none": needs nothing). */
  equipment: readonly string[];
};

export type SearchPlan = {
  /** The folded words of the search, in order. */
  tokens: string[];
  terms: SearchTerm[];
};

/** At most this many words of a search are read. */
export const MAX_SEARCH_TOKENS = 12;

function sameTokens(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

function withTyped(typed: string[], others: ReadonlyArray<readonly string[]>): string[][] {
  return [typed, ...others.filter((tokens) => !sameTokens(tokens, typed)).map((tokens) => [...tokens])];
}

function termFor(entry: Entry, typed: string[]): SearchTerm {
  const text = typed.join(" ");
  if (entry.kind === "phrase") return { text, kind: "phrase", alternatives: withTyped(typed, entry.members), regions: [], equipment: [] };
  if (entry.kind === "muscle") return { text, kind: "muscle", alternatives: withTyped(typed, entry.words), regions: entry.regions, equipment: [] };
  if (entry.kind === "equipment") return { text, kind: "equipment", alternatives: withTyped(typed, entry.words), regions: [], equipment: entry.keys };
  return { text, kind: "full_body", alternatives: withTyped(typed, entry.words), regions: [], equipment: [] };
}

/**
 * Splits a search into terms: the longest known phrase at each position ("lat pulldown", "lower back", "ez bar"),
 * and runs of other words kept together (so "pull down" can match "Pulldown").
 */
export function parseSearch(query: string): SearchPlan {
  const tokens = textTokens(query).slice(0, MAX_SEARCH_TOKENS);
  const terms: SearchTerm[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) terms.push({ text: run.join(" "), kind: "words", alternatives: [run], regions: [], equipment: [] });
    run = [];
  };
  for (let index = 0; index < tokens.length;) {
    let found: { entry: Entry; length: number } | null = null;
    for (let length = Math.min(longestEntry, tokens.length - index); length >= 1 && !found; length -= 1) {
      const entry = DICTIONARY.get(tokens.slice(index, index + length).join(" "));
      if (entry) found = { entry, length };
    }
    if (!found) { run.push(tokens[index]); index += 1; continue; }
    flush();
    terms.push(termFor(found.entry, tokens.slice(index, index + found.length)));
    index += found.length;
  }
  flush();
  return { tokens, terms };
}

// ---------------------------------------------------------------- matching a name

/** How well a word sequence matched a name: per-word quality averaged (1 exact, 0.9 joined, 0.75 partial). */
export type Coverage = { quality: number; matched: number[]; contiguous: boolean };

const EXACT = 1;
const JOINED = 0.9;
const PARTIAL = 0.75;

/**
 * Name tokens from `start` whose letters, joined, are `text` (or begin with it when `partial`): "pushup" covers
 * Push-Up's "push" + "up"; "benchpre" covers "bench" + "press". Matches start at a word, so "row" never matches
 * inside "throw". Returns the covered token indexes, or null.
 */
function alignedAt(name: NameIndex, start: number, text: string, partial: boolean): number[] | null {
  let joined = "";
  for (let end = start; end < name.tokens.length; end += 1) {
    const previous = joined.length;
    joined += name.tokens[end];
    if (joined === text || (partial && joined.startsWith(text) && text.length > previous)) {
      return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
    }
    if (!text.startsWith(joined)) return null;
  }
  return null;
}

function aligned(name: NameIndex, text: string, partial: boolean, taken: ReadonlySet<number>): number[] | null {
  for (let start = 0; start < name.tokens.length; start += 1) {
    if (taken.has(start)) continue;
    const found = alignedAt(name, start, text, partial);
    if (found && !found.some((index) => taken.has(index))) return found;
  }
  return null;
}

/**
 * Whether every word of `sequence` is in the name (any order): as a whole word, as several typed words written
 * joined in the name ("pull down" → "Pulldown"), as a joined word written apart in the name ("benchpress" →
 * "Bench Press") or, unless `exact`, as the start of a word ("benc"). Linking words may be missing.
 */
export function coverName(sequence: readonly string[], name: NameIndex, exact = false): Coverage | null {
  const matched: number[] = [];
  const taken = new Set<number>();
  let quality = 0;
  let counted = 0;
  const take = (indexes: readonly number[]) => { for (const index of indexes) { taken.add(index); matched.push(index); } };
  for (let index = 0; index < sequence.length;) {
    let advanced = false;
    // Several typed words in a row: written the same way in the name, or joined there ("pull down" → "Pulldown").
    for (let end = sequence.length; end > index + 1 && !advanced; end -= 1) {
      const words = sequence.slice(index, end);
      const found = aligned(name, words.join(""), !exact && end === sequence.length, taken);
      if (!found) continue;
      const same = found.length === words.length && found.every((at, offset) => name.tokens[at] === words[offset]);
      take(found);
      quality += (same ? EXACT : JOINED) * words.length;
      counted += words.length;
      index = end;
      advanced = true;
    }
    if (advanced) continue;
    const word = sequence[index];
    const whole = name.tokens.findIndex((token, at) => token === word && !taken.has(at));
    if (whole >= 0) { take([whole]); quality += EXACT; counted += 1; index += 1; continue; }
    const joined = word.length >= 4 ? aligned(name, word, false, taken) : null;
    if (joined) { take(joined); quality += JOINED; counted += 1; index += 1; continue; }
    if (!exact) {
      const start = name.tokens.findIndex((token, at) => token.startsWith(word) && !taken.has(at));
      if (start >= 0) { take([start]); quality += PARTIAL; counted += 1; index += 1; continue; }
      const across = word.length >= 5 ? aligned(name, word, true, taken) : null;
      if (across) { take(across); quality += PARTIAL; counted += 1; index += 1; continue; }
    }
    if (STOP_WORDS.has(word)) { index += 1; continue; }
    return null;
  }
  const order = [...matched];
  const contiguous = order.length > 1 && order.every((value, at) => at === 0 || value === order[at - 1] + 1);
  return { quality: counted ? quality / counted : 0, matched: [...new Set(matched)].sort((a, b) => a - b), contiguous };
}

// ---------------------------------------------------------------- scoring an exercise

/** The fields of a catalogue exercise a search reads. */
export type SearchableExercise = {
  name: string;
  primary_muscle: string | null;
  secondary_muscles?: readonly string[] | null;
  required_equipment: readonly string[];
};

/** How one term matched: through the name (typed words or a synonym), the muscles or the equipment. */
export type TermMatchVia = "typed" | "synonym" | "primary" | "secondary" | "equipment" | "full_body";
export type TermMatch = { score: number; via: TermMatchVia; matched: number[] };

/**
 * Points per term. Words the member typed beat a synonym. For a muscle word, an exercise that trains the muscle as
 * its main muscle beats one that only has the word in its name ("Chin To Chest Stretch" for "chest"), which beats
 * one that only assists with it (the word in its name adds a point there). For an equipment word, needing the item
 * counts most and the word in the name adds a point.
 */
export const TERM_POINTS = {
  typed: 10,
  synonym: 7,
  contiguous: 1,
  primary: 7,
  nameOnly: 4,
  secondary: 3,
  nameBonus: 1,
  equipment: 7,
  equipmentNameOnly: 5,
  fullBody: 7,
} as const;

export type ScoreOptions = {
  /** Whether the exercise counts as full body (focus.ts isFullBodyExercise); full-body words need it. */
  isFullBody?: (exercise: SearchableExercise) => boolean;
};

/** A known phrase found with other words in between ("press … up" in "Press Sit-Up") counts this much. */
export const SPLIT_PHRASE_FACTOR = 0.6;

function scoreTerm(term: SearchTerm, exercise: SearchableExercise, name: NameIndex, options: ScoreOptions): TermMatch | null {
  if (term.kind === "words") {
    // Words the vocabulary does not know: any order, and the last ones may be partly typed.
    const coverage = coverName(term.alternatives[0], name);
    if (!coverage) return null;
    return { score: TERM_POINTS.typed * coverage.quality + (coverage.contiguous ? TERM_POINTS.contiguous : 0), via: "typed", matched: coverage.matched };
  }
  if (term.kind === "phrase") {
    // A known gym term is complete words: whole words only, ideally side by side.
    let best: TermMatch | null = null;
    term.alternatives.forEach((sequence, index) => {
      const coverage = coverName(sequence, name, true);
      if (!coverage) return;
      const together = sequence.length < 2 || coverage.contiguous;
      const base = index === 0 ? TERM_POINTS.typed : TERM_POINTS.synonym;
      const score = base * coverage.quality * (together ? 1 : SPLIT_PHRASE_FACTOR) + (index === 0 && together && sequence.length > 1 ? TERM_POINTS.contiguous : 0);
      if (!best || score > best.score) best = { score, via: index === 0 ? "typed" : "synonym", matched: coverage.matched };
    });
    return best;
  }
  // Muscle, equipment and full-body words: the name has one of the words (whole words only, so "lat" never
  // matches "Lateral"), and the catalogue's muscles or equipment say whether the exercise really is one.
  let named: number[] | null = null;
  for (const sequence of term.alternatives) {
    const coverage = coverName(sequence, name, true);
    if (coverage) { named = coverage.matched; break; }
  }
  const bonus = named ? TERM_POINTS.nameBonus : 0;
  const matched = named ?? [];
  if (term.kind === "muscle") {
    // The main muscle decides; the word in a name only lifts an exercise the muscle merely assists with.
    const { primary, secondary } = exerciseRegions(exercise.primary_muscle, exercise.secondary_muscles);
    if (primary.some((region) => term.regions.includes(region))) return { score: TERM_POINTS.primary, via: "primary", matched };
    if (named) return { score: Math.max(TERM_POINTS.nameOnly, TERM_POINTS.secondary + bonus), via: "typed", matched };
    if (secondary.some((region) => term.regions.includes(region))) return { score: TERM_POINTS.secondary, via: "secondary", matched };
    return null;
  }
  if (term.kind === "equipment") {
    const needs = term.equipment.some((key) => (key === "none" ? exercise.required_equipment.length === 0 : exercise.required_equipment.includes(key)));
    if (needs) return { score: TERM_POINTS.equipment + bonus, via: "equipment", matched };
    return named ? { score: TERM_POINTS.equipmentNameOnly, via: "typed", matched } : null;
  }
  if (options.isFullBody?.(exercise)) return { score: TERM_POINTS.fullBody + bonus, via: "full_body", matched };
  return named ? { score: TERM_POINTS.nameOnly, via: "typed", matched } : null;
}

export type SearchMatch = {
  /** Higher is better; 0 for an empty search. */
  score: number;
  /** Name tokens the search matched (for highlighting), in order. */
  matched: number[];
  /** How each term matched, in plan order. */
  terms: TermMatch[];
};

/** Bonus when the name is exactly the search, and the cost per name word the search did not ask for (capped). */
export const EXACT_NAME_BONUS = 25;
export const EXTRA_WORD_COST = 0.2;
export const MAX_EXTRA_WORD_COST = 2;

/** How an exercise matches a search, or null when it does not (every term must match). */
export function matchExercise(exercise: SearchableExercise, plan: SearchPlan, options: ScoreOptions = {}): SearchMatch | null {
  if (!plan.terms.length) return { score: 0, matched: [], terms: [] };
  const name = nameIndex(exercise.name);
  const terms: TermMatch[] = [];
  const matched = new Set<number>();
  let score = 0;
  for (const term of plan.terms) {
    const match = scoreTerm(term, exercise, name, options);
    if (!match) return null;
    terms.push(match);
    score += match.score;
    for (const index of match.matched) matched.add(index);
  }
  if (name.joined === plan.tokens.join("")) score += EXACT_NAME_BONUS;
  else if (matched.size) score -= Math.min(MAX_EXTRA_WORD_COST, EXTRA_WORD_COST * (name.tokens.length - matched.size));
  return { score, matched: [...matched].sort((a, b) => a - b), terms };
}

/** Score bands: results in one band are ordered by other things (what you can do, focus, staples). */
export function relevanceBand(score: number): number {
  return Math.floor(score / 2.5);
}

/** [start, end) ranges of the name to highlight for a match, merged when adjacent. */
export function highlightRanges(name: string, matched: readonly number[]): Array<[number, number]> {
  const spans = nameIndex(name).spans;
  const ranges: Array<[number, number]> = [];
  for (const index of [...matched].sort((a, b) => a - b)) {
    const span = spans[index];
    if (!span) continue;
    const last = ranges[ranges.length - 1];
    if (last && /^[\s\-–/]*$/.test(name.slice(last[1], span[0]))) last[1] = span[1];
    else ranges.push([span[0], span[1]]);
  }
  return ranges;
}

// ---------------------------------------------------------------- "did you mean"

/** Folded name words and how often each appears, for spelling suggestions. */
export type Vocabulary = ReadonlyMap<string, number>;

export function buildVocabulary(names: Iterable<string>): Vocabulary {
  const counts = new Map<string, number>();
  for (const name of names) for (const token of new Set(nameIndex(name).tokens)) if (token.length >= 2) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const key of DICTIONARY.keys()) if (!key.includes(" ")) counts.set(key, Math.max(counts.get(key) ?? 0, 1));
  return counts;
}

/** Edit distance with swapped neighbours counted as one edit (optimal string alignment). */
export function editDistance(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      rows[i][j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) return limit + 1;
  }
  return rows[a.length][b.length];
}

function knownWord(token: string, vocabulary: Vocabulary): boolean {
  if (STOP_WORDS.has(token) || DICTIONARY.has(token) || vocabulary.has(token)) return true;
  for (const word of vocabulary.keys()) if (word.startsWith(token)) return true;
  return false;
}

/**
 * A corrected search for words no exercise name has ("bech pres" → "bench press"), or null when every word is
 * known or nothing close enough exists. One or two letters may differ (two for words of five letters or more).
 */
export function suggestSpelling(query: string, vocabulary: Vocabulary): string | null {
  const tokens = textTokens(query).slice(0, MAX_SEARCH_TOKENS);
  if (!tokens.length) return null;
  let changed = false;
  const corrected = tokens.map((token) => {
    if (token.length < 3 || knownWord(token, vocabulary)) return token;
    const limit = token.length >= 5 ? 2 : 1;
    let best: { word: string; distance: number; count: number } | null = null;
    for (const [word, count] of vocabulary) {
      if (word.length < 3 || Math.abs(word.length - token.length) > limit) continue;
      const distance = editDistance(token, word, limit);
      if (distance > limit) continue;
      if (!best || distance < best.distance || (distance === best.distance && (count > best.count || (count === best.count && word < best.word)))) best = { word, distance, count };
    }
    if (!best) return token;
    changed = true;
    return best.word;
  });
  if (!changed) return null;
  // A word typed only in part ("pres") is shown whole in the suggestion: the most common word it starts.
  return corrected.map((token) => {
    if (STOP_WORDS.has(token) || DICTIONARY.has(token) || vocabulary.has(token)) return token;
    let whole: { word: string; count: number } | null = null;
    for (const [word, count] of vocabulary) {
      if (word.startsWith(token) && (!whole || count > whole.count || (count === whole.count && word < whole.word))) whole = { word, count };
    }
    return whole?.word ?? token;
  }).join(" ");
}
