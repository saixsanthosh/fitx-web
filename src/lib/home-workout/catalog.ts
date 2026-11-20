/**
 * What the Home workout page shows for each camera exercise, beside its rule: the group it is
 * filed under, what it needs, what it works, three short cues, its poster and the joint whose angle
 * the demonstration draws. The counting itself lives in src/lib/form-rules.
 */
import { HOMEWORKOUT1_MEDIA } from "@/data/home-workout-1-media";
import { HOMEWORKOUT2_MEDIA } from "@/data/home-workout-2-media";
import { EXERCISE_RULES } from "@/lib/form-rules/catalog";
import type { ExerciseId, ExerciseRule } from "@/lib/form-rules/types";
import type { Part, SideKey } from "./figure";

export type ExerciseGroup = "legs" | "upper" | "core" | "cardio";

export const GROUP_LABELS: Record<ExerciseGroup, string> = { legs: "Legs", upper: "Upper body", core: "Core", cardio: "Cardio" };

export interface PosterImage {
  src: string;
  width: number;
  height: number;
  alt: string;
  blurDataURL: string;
}

export interface HomeExercise {
  id: ExerciseId;
  rule: ExerciseRule;
  group: ExerciseGroup;
  /** What to have at home, or null for none. */
  equipment: string | null;
  /** Muscles worked, a few words. */
  works: string;
  /** Three short cues shown beside the demonstration. */
  cues: readonly [string, string, string];
  poster: PosterImage;
  /** The joint angle the demonstration labels: [outer, middle, outer] on one side. */
  angle: { side: SideKey; joints: readonly [Part, Part, Part] } | null;
}

type Meta = Omit<HomeExercise, "id" | "rule">;

const META: Record<ExerciseId, Meta> = {
  push_up: { group: "upper", equipment: null, works: "Chest, triceps, core", cues: ["Hands under shoulders", "Body in one line", "Chest to fist height"], poster: HOMEWORKOUT1_MEDIA["push-up"], angle: { side: "near", joints: ["shoulder", "elbow", "wrist"] } },
  bodyweight_squat: { group: "legs", equipment: null, works: "Quads, glutes", cues: ["Feet shoulder-width", "Sit your hips back", "Chest up"], poster: HOMEWORKOUT1_MEDIA.squat, angle: { side: "near", joints: ["hip", "knee", "ankle"] } },
  split_squat: { group: "legs", equipment: null, works: "Quads, glutes", cues: ["Long split stance", "Back knee to the floor", "Torso tall"], poster: HOMEWORKOUT1_MEDIA["split-squat"], angle: { side: "near", joints: ["hip", "knee", "ankle"] } },
  glute_bridge: { group: "legs", equipment: null, works: "Glutes, hamstrings", cues: ["Feet flat, knees bent", "Drive through your heels", "Ribs down at the top"], poster: HOMEWORKOUT1_MEDIA["glute-bridge"], angle: { side: "near", joints: ["shoulder", "hip", "knee"] } },
  plank: { group: "core", equipment: null, works: "Core, shoulders", cues: ["Elbows under shoulders", "Squeeze your glutes", "One straight line"], poster: HOMEWORKOUT1_MEDIA.plank, angle: { side: "near", joints: ["shoulder", "hip", "ankle"] } },
  jumping_jack: { group: "cardio", equipment: null, works: "Full body", cues: ["Arms all the way up", "Land with feet wide", "Soft knees"], poster: HOMEWORKOUT1_MEDIA["jumping-jack"], angle: { side: "near", joints: ["hip", "shoulder", "wrist"] } },
  reverse_lunge: { group: "legs", equipment: null, works: "Quads, glutes", cues: ["Step back long", "Back knee to the floor", "Drive up through the front heel"], poster: HOMEWORKOUT1_MEDIA["reverse-lunge"], angle: { side: "near", joints: ["hip", "knee", "ankle"] } },
  high_knees: { group: "cardio", equipment: null, works: "Hip flexors, calves", cues: ["Knees to hip height", "Stay upright", "Quick, light feet"], poster: HOMEWORKOUT2_MEDIA["high-knees"], angle: null },
  mountain_climber: { group: "core", equipment: null, works: "Core, shoulders", cues: ["Hands under shoulders", "Knee in under your chest", "Hips level"], poster: HOMEWORKOUT2_MEDIA["mountain-climber"], angle: { side: "near", joints: ["shoulder", "hip", "knee"] } },
  side_plank: { group: "core", equipment: null, works: "Obliques, shoulders", cues: ["Elbow under shoulder", "Feet stacked", "Hips high, body straight"], poster: HOMEWORKOUT2_MEDIA["side-plank"], angle: { side: "near", joints: ["shoulder", "hip", "ankle"] } },
  wall_sit: { group: "legs", equipment: "A wall", works: "Quads", cues: ["Back flat on the wall", "Thighs level", "Knees over ankles"], poster: HOMEWORKOUT2_MEDIA["wall-sit"], angle: { side: "near", joints: ["hip", "knee", "ankle"] } },
  superman: { group: "core", equipment: null, works: "Lower back, glutes", cues: ["Reach long", "Lift chest and legs together", "Eyes on the floor"], poster: HOMEWORKOUT2_MEDIA.superman, angle: null },
  shoulder_press: { group: "upper", equipment: "Light dumbbells", works: "Shoulders, triceps", cues: ["Weights at shoulder height", "Press straight up", "Ribs down"], poster: HOMEWORKOUT2_MEDIA["shoulder-press"], angle: { side: "near", joints: ["shoulder", "elbow", "wrist"] } },
  biceps_curl: { group: "upper", equipment: "Light dumbbells", works: "Biceps", cues: ["Elbows at your sides", "Curl to the shoulder", "Lower all the way"], poster: HOMEWORKOUT2_MEDIA["biceps-curl"], angle: { side: "near", joints: ["shoulder", "elbow", "wrist"] } },
};

/** Every camera exercise with its page details, in the catalogue's order. */
export const HOME_EXERCISES: readonly HomeExercise[] = EXERCISE_RULES.map((rule) => ({ id: rule.id, rule, ...META[rule.id] }));

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
