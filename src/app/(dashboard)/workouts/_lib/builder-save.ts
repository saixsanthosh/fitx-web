/**
 * The workout builder's checks before a save, each tied to the control it is about (bug 85: "Give this workout a
 * name." used to appear at the very bottom of the dialog, 1,600 px below the name field, with the field unmarked).
 * `name` and `date` messages show under their field, which is marked invalid and takes focus; `save` messages
 * show beside the Save buttons; `picker` ones under the exercise list they came from. Pure.
 */
export type BuilderProblem = { at: "name" | "date" | "picker" | "save"; message: string };

export function builderSaveProblem(input: {
  title: string;
  exerciseCount: number;
  /** The plan is a programme day, whose date stays (`plannedFor` must equal `originalPlannedFor`). */
  programmeDay: boolean;
  plannedFor: string;
  originalPlannedFor: string | null;
}): BuilderProblem | null {
  if (!input.title.trim()) return { at: "name", message: "Give this workout a name." };
  if (input.exerciseCount === 0) return { at: "save", message: "Choose at least one exercise for your workout." };
  if (input.programmeDay && input.plannedFor !== input.originalPlannedFor) return { at: "date", message: "A programme day keeps its date." };
  return null;
}

/** The ids that tie a field to its message. */
export const BUILDER_FIELD_IDS = {
  name: { field: "builder-name", message: "builder-name-error" },
  date: { field: "builder-date", message: "builder-date-error" },
} as const;
