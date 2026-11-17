import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExerciseDetailView } from "@/components/exercises/detail/ExerciseDetailView";
import { exerciseHref, exerciseTabFrom } from "@/components/exercises/detail/detail-tabs";
import { survivingExerciseId } from "@/lib/training/exercise-merges";

export const metadata: Metadata = { title: "Exercise" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * An exercise's page: /exercises/<id>?tab=guide|muscles|history|progress. A merged duplicate (an old link, a saved
 * or recent id) opens the exercise it was merged into, on the same tab. The page itself loads in the browser
 * (ExerciseDetailView) with the member's own session.
 */
export default async function ExerciseDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tab = exerciseTabFrom(query.tab);
  const survivor = survivingExerciseId(id);
  if (survivor !== id) redirect(exerciseHref(survivor, tab));
  return <ExerciseDetailView key={id} id={id} initialTab={tab} />;
}
