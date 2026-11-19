"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormCoach } from "@/components/form-coach/FormCoach";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { HOME_WORKOUT } from "@/config/routes";
import { ExercisePicker } from "./ExercisePicker";

/** Practice: pick an exercise (kept in the address, so it can be linked to), count, see a summary. Nothing is saved. */
export function FormCoachPractice() {
  const params = useSearchParams();
  const router = useRouter();
  const rule = getExerciseRule(params.get("exercise") ?? "");
  if (!rule) return <ExercisePicker />;
  return <FormCoach key={rule.id} rule={rule} mode="practice" onChangeExercise={() => router.replace(HOME_WORKOUT, { scroll: false })} />;
}
