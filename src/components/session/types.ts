/** The live workout's exercises and sets as the page holds them: saved values plus what is typed but not saved. */

export type RepSource = "manual" | "camera";

export type LiveSet = {
  id: string;
  set_number: number;
  target_reps: number | null;
  reps: number | null;
  weight_kg: number;
  duration_seconds: number | null;
  completed_at: string | null;
  /** Where the saved count came from; null when typed before the label existed or the database lacks it. */
  rep_source: RepSource | null;
  draftWeight: string;
  draftReps: string;
  draftDuration: string;
};

export type LiveExercise = {
  id: string;
  exercise_id: string | null;
  name: string;
  target_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  target_weight_kg: number | null;
  target_duration_seconds: number | null;
  sort_order: number;
  sets: LiveSet[];
};

export type DraftField = "draftWeight" | "draftReps" | "draftDuration";
