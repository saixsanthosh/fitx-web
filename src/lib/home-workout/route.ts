/**
 * Where AI Form Check lives. `/home-workout` and `/form-coach` (the older names) redirect here,
 * keeping `?exercise=`. brand-nav adds the same path to src/config/routes.ts as `FORM_CHECK`; this
 * copy keeps the form-check code free of files other streams create in this wave.
 */
import { cameraRuleFor, getExerciseRule } from "@/lib/form-rules/catalog";

export const FORM_CHECK_PATH = "/workouts/form-check";

/**
 * The AI Form Check page, opened on one exercise when it is given. `exercise` may be a camera rule
 * id ("push_up") or an exercise_library id ("free-exercise-db-Pushups"); `name` is matched the way
 * cameraRuleFor({ id, name }) matches it, for library exercises known to the camera by name only.
 * Null when the camera can't analyse that exercise, so callers show nothing rather than a dead link.
 */
export function formCheckHref(exercise?: string | null, name?: string | null): string | null {
  if (!exercise && !name) return FORM_CHECK_PATH;
  const rule = (exercise ? getExerciseRule(exercise) : null) ?? cameraRuleFor({ id: exercise || null, name: name || null });
  return rule ? `${FORM_CHECK_PATH}?exercise=${encodeURIComponent(rule.id)}` : null;
}

/** The redirect target for an old `/home-workout` or `/form-coach` address: every query parameter is kept. */
export function legacyFormCheckTarget(search: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) params.append(key, one);
  }
  const query = params.toString();
  return query ? `${FORM_CHECK_PATH}?${query}` : FORM_CHECK_PATH;
}
