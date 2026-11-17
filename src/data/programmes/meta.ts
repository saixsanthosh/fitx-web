/*
 * What each authored programme is for and how long it runs, kept in code beside the programmes (index.ts) and
 * keyed by programme id, so it needs no database change: a programme read from the database finds its entry by id.
 *
 * Lengths are FITX's own programme design, like the programmes themselves: a block to follow before reviewing
 * progress (30 days for the home plans, 6 weeks for the intermediate splits, 8 weeks for the beginner gym
 * splits), from widely used public training guidance. Not yet reviewed by a FITX coach; the programme's
 * `sourceNotes` says so in the app. A length sets the number of sessions (the chosen training weekdays in that
 * many days from the start); progress counts completed sessions, so a missed day extends the plan.
 *
 * No imports, so scripts can load this file with plain node.
 */

export type ProgrammeMeta = {
  /** How many days the plan runs from the day it starts; null for an ongoing programme that repeats its cycle. */
  lengthDays: number | null;
  /** One plain sentence: what following the programme is for. */
  objective: string;
};

export const PROGRAMME_META: Readonly<Record<string, ProgrammeMeta>> = {
  "ppl-3": { lengthDays: 56, objective: "Build muscle and strength with pushing, pulling and leg days, each once a week." },
  "ppl-6": { lengthDays: 42, objective: "Build muscle by training each muscle group twice a week, with a different main lift each time." },
  "bro-split-5": { lengthDays: 42, objective: "Build muscle with a high-volume day for each muscle group." },
  "upper-lower-4": { lengthDays: 56, objective: "Build strength and muscle with a heavier and a lighter day for the upper and lower body." },
  "full-body-3": { lengthDays: 56, objective: "Learn the main lifts and build all-round strength in three short sessions a week." },
  "home-bodyweight-3": { lengthDays: 30, objective: "Build all-round strength and fitness at home with no equipment." },
  "home-dumbbell-4": { lengthDays: 30, objective: "Build strength and muscle at home with a pair of dumbbells." },
};

/** The metadata of a programme, or null when it has none (a programme added later without an entry). */
export function programmeMeta(id: string | null | undefined): ProgrammeMeta | null {
  return id && Object.hasOwn(PROGRAMME_META, id) ? PROGRAMME_META[id] : null;
}

/** "30-day plan", "6-week plan" (whole weeks), or "Ongoing" for a programme without a length. */
export function programmeLengthLabel(lengthDays: number | null | undefined): string {
  if (!lengthDays || lengthDays <= 0) return "Ongoing";
  return lengthDays % 7 === 0 ? `${lengthDays / 7}-week plan` : `${lengthDays}-day plan`;
}
