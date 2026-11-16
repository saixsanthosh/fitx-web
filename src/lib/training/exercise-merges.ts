/**
 * The imported exercises that the catalogue clean-up (20261118130010) merged into a FITX starter
 * exercise: duplicate id -> surviving id. Merged rows are hidden, so ids saved or viewed on this device
 * before the clean-up (Saved, Recently viewed, links) are read as their survivor.
 * scripts/catalog/catalog.test.mjs checks this list against the clean-up's merges.
 */
export const MERGED_EXERCISE_IDS: Readonly<Record<string, string>> = {
  "free-exercise-db-Barbell_Bench_Press_-_Medium_Grip": "bench_press",
  "free-exercise-db-Barbell_Hip_Thrust": "hip_thrust",
  "free-exercise-db-Barbell_Squat": "barbell_back_squat",
  "free-exercise-db-Bent_Over_Barbell_Row": "barbell_row",
  "free-exercise-db-Bodyweight_Walking_Lunge": "walking_lunge",
  "free-exercise-db-Butt_Lift_Bridge": "glute_bridge",
  "free-exercise-db-Dumbbell_Bicep_Curl": "biceps_curl",
  "free-exercise-db-Lateral_Raise_-_With_Bands": "band_lateral_raise",
  "free-exercise-db-Plank": "plank",
  "free-exercise-db-Pullups": "pull_up",
  "free-exercise-db-Pushups": "push_up",
  "free-exercise-db-Seated_Cable_Rows": "seated_cable_row",
  "free-exercise-db-Side_Lateral_Raise": "lateral_raise",
  "free-exercise-db-Standing_Dumbbell_Triceps_Extension": "triceps_extension",
  "free-exercise-db-Wide-Grip_Lat_Pulldown": "lat_pulldown",
};

/** The id an exercise is listed under now: its survivor when it was merged, else itself. */
export function survivingExerciseId(id: string): string {
  return Object.hasOwn(MERGED_EXERCISE_IDS, id) ? MERGED_EXERCISE_IDS[id] : id;
}

/** Ids read as their survivors, without repeats, in their order. */
export function survivingExerciseIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map(survivingExerciseId))];
}

/** The stored ids that read as this exercise: itself, or a duplicate merged into it. */
export function storedIdsFor(stored: readonly string[], exerciseId: string): string[] {
  return stored.filter((id) => survivingExerciseId(id) === exerciseId);
}
