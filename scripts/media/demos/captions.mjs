// The two captions of a demonstration (start frame, end frame), never invented:
//  - the AI Form Check exercises reuse the phase words of src/lib/home-workout/demo-script.ts (reviewed FITX copy):
//    the start phase for the start frame, the turnaround (or, for holds, the hold) for the end frame;
//  - every other exercise takes the lead sentence of its own catalogue steps (guideSteps and splitStep in
//    src/lib/training/exercise-guide.ts): the step that sets up the starting position, then the step after it.
// A lead longer than CAPTION_MAX is cut before a clause (a comma, "while", "as you"...) when that leaves a whole clause; otherwise the
// caption is left empty and listed as "needs writing", so a person writes it (tests check every caption's source).
export const CAPTION_MAX = 120;
const MIN_CLAUSE = 24;
const START_WORDS = /starting position|start position|begin|start with|to start/i;

/** Where a long lead may be cut, leaving a whole clause: before these words or after this punctuation. */
const CUTS = [", ", "; ", " as you ", " while ", " and ", " until "];

/** A lead sentence that fits, or "" when it cannot be shortened to a whole clause (always a substring of `text`). */
export function fitCaption(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= CAPTION_MAX) return clean.replace(/\s+[\u2013-]$/, "");
  const head = clean.slice(0, CAPTION_MAX);
  const cut = Math.max(...CUTS.map((word) => head.lastIndexOf(word)));
  return cut >= MIN_CLAUSE ? head.slice(0, cut).replace(/[\s,;:\u2013-]+$/, "") : "";
}

/** True for a step that only says "This will be your starting position." and nothing to show. */
const onlyMarker = (text) => /^(this|that) (will be|is) your start(ing)? position\.?$/i.test(text.trim());
/** Leads that say nothing about the position on screen. */
const NOT_A_POSITION = /^(for this exercise|note|tip|caution|warning|variations?|repeat|switch sides|alternate)\b/i;
const usable = (step) => Boolean(step?.lead) && !onlyMarker(step.lead) && !NOT_A_POSITION.test(step.lead.trim());

/**
 * Captions from the catalogue steps: [start, end]. The start is the step that sets up the starting position (looked
 * for in the first half of the steps, else the first usable step); the end is the next usable step after it.
 */
export function stepCaptions(steps) {
  if (!steps.length) return ["", ""];
  const half = Math.max(2, Math.ceil(steps.length / 2));
  let start = steps.slice(0, half).findIndex((step) => START_WORDS.test(step.text) && usable(step));
  if (start < 0) start = steps.findIndex(usable);
  if (start < 0) return ["", ""];
  const next = steps.slice(start + 1).find(usable);
  return [fitCaption(steps[start].lead), next ? fitCaption(next.lead) : ""];
}

/** Captions from a demo script: the start phase, then the turnaround (reps) or the hold (holds). */
export function scriptCaptions(script) {
  const phases = script?.phases ?? [];
  if (!phases.length) return ["", ""];
  const end = phases.length >= 4 ? phases[2] : phases[1] ?? phases[0];
  return [fitCaption(phases[0].caption), fitCaption(end.caption)];
}

/** The captions for one exercise id, from the repo data loaded by demo-priority.mjs. */
export function captionsFor(id, data) {
  const rule = data.formCheck.find((item) => item.libraryIds.includes(id) && item.script);
  if (rule) return scriptCaptions(rule.script);
  return stepCaptions(data.guideSteps(data.instructions.get(id) ?? []));
}

/** Every phase caption of every demo script: the reviewed FITX-written list a caption may come from. */
export function fitxWrittenCaptions(formCheck) {
  return new Set(formCheck.flatMap((rule) => (rule.script?.phases ?? []).map((phase) => phase.caption)));
}
