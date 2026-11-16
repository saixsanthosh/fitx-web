import type { MuscleGroup } from "./taxonomy";

/**
 * Well-known lifts per muscle group, most standard first. The generator and the substitution
 * ranking prefer these over the many niche variants in the imported catalogue. Every id here must
 * exist and be active in the cleaned catalogue (tests/training/golden.test.ts); duplicates merged
 * by the clean-up are referred to by their surviving FITX starter id.
 */
export const STAPLE_EXERCISES: Readonly<Partial<Record<MuscleGroup, readonly string[]>>> = {
  chest: [
    "bench_press", "dumbbell_bench_press", "incline_dumbbell_press",
    "free-exercise-db-Barbell_Incline_Bench_Press_-_Medium_Grip", "push_up", "free-exercise-db-Dips_-_Chest_Version",
    "free-exercise-db-Dumbbell_Flyes", "cable_fly", "free-exercise-db-Cable_Crossover", "free-exercise-db-Butterfly",
    "free-exercise-db-Incline_Push-Up", "free-exercise-db-Decline_Push-Up",
  ],
  back: [
    "pull_up", "free-exercise-db-Chin-Up", "lat_pulldown", "free-exercise-db-Close-Grip_Front_Lat_Pulldown", "barbell_row", "seated_cable_row",
    "one_arm_dumbbell_row", "free-exercise-db-Bent_Over_Two-Dumbbell_Row",
    "free-exercise-db-T-Bar_Row_with_Handle", "free-exercise-db-Inverted_Row", "band_row", "free-exercise-db-Barbell_Deadlift",
    "free-exercise-db-Hyperextensions_Back_Extensions", "free-exercise-db-Superman", "free-exercise-db-Barbell_Shrug", "free-exercise-db-Dumbbell_Shrug",
  ],
  shoulders: [
    "free-exercise-db-Standing_Military_Press", "dumbbell_shoulder_press", "free-exercise-db-Arnold_Dumbbell_Press", "lateral_raise",
    "free-exercise-db-Cable_Seated_Lateral_Raise", "band_lateral_raise", "free-exercise-db-Face_Pull",
    "free-exercise-db-Reverse_Flyes", "free-exercise-db-Dumbbell_Lying_Rear_Lateral_Raise", "free-exercise-db-Handstand_Push-Ups",
  ],
  biceps: [
    "free-exercise-db-Barbell_Curl", "biceps_curl", "free-exercise-db-Hammer_Curls",
    "free-exercise-db-EZ-Bar_Curl", "free-exercise-db-Preacher_Curl", "free-exercise-db-Cable_Hammer_Curls_-_Rope_Attachment",
  ],
  triceps: [
    "free-exercise-db-Close-Grip_Barbell_Bench_Press", "free-exercise-db-Dips_-_Triceps_Version", "free-exercise-db-Triceps_Pushdown",
    "free-exercise-db-Triceps_Pushdown_-_Rope_Attachment", "free-exercise-db-Lying_Triceps_Press", "free-exercise-db-EZ-Bar_Skullcrusher",
    "triceps_extension", "free-exercise-db-Bench_Dips",
  ],
  quadriceps: [
    "barbell_back_squat", "free-exercise-db-Barbell_Full_Squat", "free-exercise-db-Front_Barbell_Squat",
    "free-exercise-db-Leg_Press", "free-exercise-db-Hack_Squat", "goblet_squat", "split_squat", "free-exercise-db-Split_Squat_with_Dumbbells",
    "walking_lunge", "free-exercise-db-Dumbbell_Lunges", "step_up", "bodyweight_squat",
    "free-exercise-db-Leg_Extensions", "free-exercise-db-Smith_Machine_Squat",
  ],
  hamstrings: [
    "romanian_deadlift", "dumbbell_rdl", "free-exercise-db-Stiff-Legged_Dumbbell_Deadlift", "free-exercise-db-Good_Morning",
    "free-exercise-db-Lying_Leg_Curls", "free-exercise-db-Seated_Leg_Curl", "free-exercise-db-Glute_Ham_Raise",
    "free-exercise-db-Kettlebell_One-Legged_Deadlift",
  ],
  glutes: [
    "hip_thrust", "glute_bridge", "free-exercise-db-Single_Leg_Glute_Bridge",
  ],
  calves: ["calf_raise", "free-exercise-db-Standing_Calf_Raises", "free-exercise-db-Seated_Calf_Raise", "free-exercise-db-Calf_Raise_On_A_Dumbbell"],
  core: [
    "plank", "dead_bug", "free-exercise-db-Hanging_Leg_Raise", "free-exercise-db-Cable_Crunch",
    "free-exercise-db-Ab_Roller", "free-exercise-db-Side_Bridge", "free-exercise-db-Crunches", "free-exercise-db-Russian_Twist",
    "free-exercise-db-Mountain_Climbers",
  ],
};

const RANK = new Map<string, number>();
for (const ids of Object.values(STAPLE_EXERCISES)) ids?.forEach((id, index) => { if (!RANK.has(id)) RANK.set(id, index); });

/** 0 for the most standard lift of its group, rising down the list; null when not a staple. */
export function stapleRank(exerciseId: string): number | null {
  return RANK.get(exerciseId) ?? null;
}
