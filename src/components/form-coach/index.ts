/**
 * Camera form coach: on-device rep counting and posture cues for the Home workout exercises.
 *
 * For a live workout, mount <CountWithCamera> beside a set; it renders only for exercises the
 * camera can count (see cameraRuleFor) and hands back a confirmed count, never video or images.
 */
export { CountWithCamera } from "./CountWithCamera";
export type { CountWithCameraProps } from "./CountWithCamera";
export { FormCoach } from "./FormCoach";
export type { CameraCountResult } from "./FormCoach";
export { ExerciseGlyph } from "./ExerciseGlyph";
export { cameraFitsSet, cameraRuleFor, EXERCISE_RULES } from "@/lib/form-rules/catalog";
