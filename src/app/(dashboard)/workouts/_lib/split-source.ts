/**
 * Where "Your split" in the workout builder takes its days from, and how the builder says so (bug 51: it used the
 * Profile's training split even for a member following Push, Pull, Legs, and said only "From Full Body · 3 days").
 * The programme the member follows comes first when it is for the same place (gym or home); then, at the gym, the
 * training split saved in Profile; at home, FITX's home track for their equipment. Pure (type-only imports).
 */
import type { Programme } from "@/lib/training/programmes";
import type { TrainingContext } from "@/lib/training/taxonomy";

export type SplitSource = {
  programme: Programme;
  source: "programme" | "profile" | "home" | "default";
  /** The builder's line under its title, e.g. "From the programme you follow: Push, Pull, Legs · 3 days". */
  label: string;
  /** The day the builder opens on: the followed programme's next day, else the first. */
  startDay: number;
};

export function builderSplit(input: {
  target: TrainingContext;
  /** The programme the member follows (active or paused), with the day they are on. */
  followed: { programme: Programme; nextDayIndex: number } | null;
  /** user_preferences.workout_split, from Profile > Training (whether one is saved decides the wording). */
  split: string | null | undefined;
  /** The authored programme for that split at the gym, or the home track (programmes.ts splitProgrammeId). */
  splitId: string;
  programmes: readonly Programme[];
}): SplitSource | null {
  const { followed, target } = input;
  if (followed && followed.programme.context === target && followed.programme.days.length) {
    const count = followed.programme.days.length;
    return { programme: followed.programme, source: "programme", label: `From the programme you follow: ${followed.programme.title}`, startDay: ((followed.nextDayIndex % count) + count) % count };
  }
  const authored = input.programmes.find((programme) => programme.id === input.splitId);
  if (authored) {
    if (target === "home") return { programme: authored, source: "home", label: `From FITX’s home track for your equipment: ${authored.title}`, startDay: 0 };
    return { programme: authored, source: input.split ? "profile" : "default", label: input.split ? `From your training split in Profile: ${authored.title}` : `From ${authored.title}`, startDay: 0 };
  }
  const fallback = input.programmes.find((programme) => programme.context === target);
  return fallback ? { programme: fallback, source: "default", label: `From ${fallback.title}`, startDay: 0 } : null;
}
