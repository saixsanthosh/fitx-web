import type { Metadata } from "next";
import { ExerciseForm, NEW_EXERCISE } from "@/components/content/exercise-form";
import { ContentHeader, contentStyles as styles } from "@/components/content/kit";
import { requireAdmin } from "@/lib/admin-auth";
import { saveExercise } from "../../actions";

export const metadata: Metadata = { title: "Add exercise" };

export default async function NewExercisePage() {
  await requireAdmin("content.manage");
  return (
    <div className={styles.page}>
      <ContentHeader eyebrow="03 Workouts" title="Add exercise" back={{ href: "/training", label: "Exercises" }} meta="It starts hidden. Add photos or a video, then show it." />
      <ExerciseForm action={saveExercise.bind(null, null)} initial={NEW_EXERCISE} creating />
    </div>
  );
}
