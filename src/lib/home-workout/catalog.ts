/**
 * What the AI Form Check page shows for each camera exercise, beside its rule: the group it is filed
 * under, what it needs, what it works, three short cues and its demonstration photos. The counting
 * itself lives in src/lib/form-rules.
 *
 * Photos are only used where they show the position they are labelled with, in correct form (each
 * was checked by eye). An exercise without a correct photo has none: its card and demonstration show
 * the captions on their own rather than a picture of the wrong thing.
 */
import { FORMCHECK_MEDIA } from "@/data/form-check-media";
import { HOMEWORKOUT1_MEDIA } from "@/data/home-workout-1-media";
import { HOMEWORKOUT2_MEDIA } from "@/data/home-workout-2-media";
import { EXERCISE_RULES } from "@/lib/form-rules/catalog";
import type { ExerciseId, ExerciseRule } from "@/lib/form-rules/types";

export type ExerciseGroup = "legs" | "upper" | "core" | "cardio";

export const GROUP_LABELS: Record<ExerciseGroup, string> = { legs: "Legs", upper: "Upper body", core: "Core", cardio: "Cardio" };

export interface PosterImage {
  src: string;
  width: number;
  height: number;
  alt: string;
  blurDataURL: string;
}

/** A photo of one position of the movement, with the position's name. */
export interface DemoPhoto {
  image: PosterImage;
  /** Shown on the photo, so it is always clear which moment it shows. */
  label: string;
}

export interface HomeExercise {
  id: ExerciseId;
  rule: ExerciseRule;
  group: ExerciseGroup;
  /** What to have, or null for none. */
  equipment: string | null;
  /** Muscles worked, a few words. */
  works: string;
  /** Three short cues shown beside the demonstration. */
  cues: readonly [string, string, string];
  /**
   * Photos of the movement's two ends: `start` (where every rep begins, or the hold itself) and `end`
   * (the turnaround). Either may be missing; a pair plays as a two-position demonstration.
   */
  photos: { start: DemoPhoto | null; end: DemoPhoto | null };
  /** The photo for its card: the turnaround, else the start; null when there is no correct photo. */
  poster: PosterImage | null;
}

type Meta = Omit<HomeExercise, "id" | "rule" | "poster">;

const photo = (image: PosterImage, label: string): DemoPhoto => ({ image, label });
const none = { start: null, end: null };

// Removed after checking by eye: superman (lifted only the chest, 2026-11-20); the first jumping jack (arms
// overhead with the feet still together); the glute bridge "top" (hips still on the mat, now used as the start).
// Generated starts for the push-up, shoulder press and bridge top did not change the pose (2026-11-23), so
// those exercises show their one correct position.
const META: Record<ExerciseId, Meta> = {
  push_up: { group: "upper", equipment: null, works: "Chest, triceps, core", cues: ["Hands under shoulders", "Body in one line", "Chest to fist height"], photos: { start: photo(HOMEWORKOUT1_MEDIA["push-up"], "Top position"), end: null } },
  bodyweight_squat: { group: "legs", equipment: null, works: "Quads, glutes", cues: ["Feet shoulder-width", "Sit your hips back", "Chest up"], photos: { start: photo(FORMCHECK_MEDIA["squat-start"], "Start"), end: photo(HOMEWORKOUT1_MEDIA.squat, "Bottom") } },
  split_squat: { group: "legs", equipment: null, works: "Quads, glutes", cues: ["Long split stance", "Back knee to the floor", "Torso tall"], photos: { start: null, end: photo(HOMEWORKOUT1_MEDIA["split-squat"], "Bottom position") } },
  glute_bridge: { group: "legs", equipment: null, works: "Glutes, hamstrings", cues: ["Feet flat, knees bent", "Drive through your heels", "Ribs down at the top"], photos: { start: photo(FORMCHECK_MEDIA["glute-bridge-start"], "Start position"), end: null } },
  plank: { group: "core", equipment: null, works: "Core, shoulders", cues: ["Hands under shoulders", "Squeeze your glutes", "One straight line"], photos: { start: photo(HOMEWORKOUT1_MEDIA.plank, "Hold"), end: null } },
  jumping_jack: { group: "cardio", equipment: null, works: "Full body", cues: ["Arms all the way up", "Land with feet wide", "Soft knees"], photos: { start: photo(FORMCHECK_MEDIA["jumping-jack-closed"], "Together"), end: photo(FORMCHECK_MEDIA["jumping-jack-open"], "Wide") } },
  reverse_lunge: { group: "legs", equipment: null, works: "Quads, glutes", cues: ["Step back long", "Back knee to the floor", "Drive up through the front heel"], photos: { start: null, end: photo(HOMEWORKOUT1_MEDIA["reverse-lunge"], "Bottom position") } },
  high_knees: { group: "cardio", equipment: null, works: "Hip flexors, calves", cues: ["Knees to hip height", "Stay upright", "Quick, light feet"], photos: { start: null, end: photo(HOMEWORKOUT2_MEDIA["high-knees"], "Knee up") } },
  mountain_climber: { group: "core", equipment: null, works: "Core, shoulders", cues: ["Hands under shoulders", "Knee in under your chest", "Hips level"], photos: { start: null, end: photo(HOMEWORKOUT2_MEDIA["mountain-climber"], "Knee in") } },
  side_plank: { group: "core", equipment: null, works: "Obliques, shoulders", cues: ["Support under your shoulder", "Feet stacked or staggered", "Hips high, body straight"], photos: { start: photo(HOMEWORKOUT2_MEDIA["side-plank"], "Hold"), end: null } },
  wall_sit: { group: "legs", equipment: "A wall", works: "Quads", cues: ["Back flat on the wall", "Thighs level", "Knees over ankles"], photos: { start: photo(HOMEWORKOUT2_MEDIA["wall-sit"], "Hold"), end: null } },
  superman: { group: "core", equipment: null, works: "Lower back, glutes", cues: ["Reach long", "Lift chest and legs together", "Eyes on the floor"], photos: none },
  shoulder_press: { group: "upper", equipment: "Light dumbbells", works: "Shoulders, triceps", cues: ["Weights at shoulder height", "Press straight up", "Ribs down"], photos: { start: null, end: photo(HOMEWORKOUT2_MEDIA["shoulder-press"], "Top position") } },
  biceps_curl: { group: "upper", equipment: "Light dumbbells", works: "Biceps", cues: ["Elbows at your sides", "Curl to the shoulder", "Lower all the way"], photos: { start: null, end: photo(HOMEWORKOUT2_MEDIA["biceps-curl"], "Top position") } },
  lateral_raise: { group: "upper", equipment: "Light dumbbells", works: "Side shoulders", cues: ["Soft elbows", "Lift to shoulder height", "Lower slowly"], photos: none },
  front_raise: { group: "upper", equipment: "Light dumbbells", works: "Front shoulders", cues: ["Arms long", "Lift to shoulder height", "No swinging"], photos: none },
  triceps_extension: { group: "upper", equipment: "One dumbbell", works: "Triceps", cues: ["Elbows point up", "Lower behind your head", "Straighten fully"], photos: none },
  romanian_deadlift: { group: "legs", equipment: "Dumbbells or a bar", works: "Hamstrings, glutes", cues: ["Soft knees", "Push your hips back", "Long, flat back"], photos: none },
  bent_over_row: { group: "upper", equipment: "Dumbbells", works: "Back, biceps", cues: ["Hinge and hold", "Elbows past your body", "Lower to straight arms"], photos: none },
  sit_up: { group: "core", equipment: null, works: "Abdominals", cues: ["Knees bent, feet flat", "Curl all the way up", "Lower with control"], photos: none },
};

/** Every camera exercise with its page details, in the catalogue's order. */
export const HOME_EXERCISES: readonly HomeExercise[] = EXERCISE_RULES.map((rule) => {
  const meta = META[rule.id];
  return { id: rule.id, rule, ...meta, poster: (meta.photos.end ?? meta.photos.start)?.image ?? null };
});

const BY_ID = new Map(HOME_EXERCISES.map((exercise) => [exercise.id as string, exercise]));

export function homeExercise(id: string | null | undefined): HomeExercise | null {
  return (id && BY_ID.get(id)) || null;
}

export const GROUP_ORDER: readonly ExerciseGroup[] = ["legs", "upper", "core", "cardio"];

/** "Reps" or "Timed hold", and which way to face the camera: the two facts that decide the set-up. */
export function exerciseFacts(rule: ExerciseRule): { counting: string; facing: string } {
  return {
    counting: rule.motion.kind === "hold" ? "Timed hold" : "Reps",
    facing: rule.view === "side" ? "Side-on" : "Facing camera",
  };
}
