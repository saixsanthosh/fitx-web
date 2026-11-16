/** Estimated one-rep max (Epley, reps capped at 12), rounded to 0.1 kg. Same formula as fitx_finish_workout_session. */
export function estimateOneRepMax(weightKg: number, reps: number) {
  if (weightKg <= 0 || reps <= 0) return 0;
  return Math.round(weightKg * (1 + Math.min(reps, 12) / 30) * 10) / 10;
}
