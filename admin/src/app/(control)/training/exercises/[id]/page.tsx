import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmSubmit, SubmitButton } from "@/components/content/confirm-submit";
import { ExerciseForm } from "@/components/content/exercise-form";
import { ContentHeader, DataState, Empty, Pill, Section, StateNotice, contentStyles as styles } from "@/components/content/kit";
import { MediaUploader } from "@/components/content/media-uploader";
import { requireAdmin } from "@/lib/admin-auth";
import { EXERCISE_ID } from "@/lib/content/exercise-input";
import { CATEGORY_LABELS, MUSCLE_GROUP_LABELS, humanise, type MuscleGroup } from "@/lib/content/vocabulary";
import { getExercise, type ExerciseMediaItem } from "@/lib/data/exercises";
import { pageNotice } from "@/lib/notice";
import { formatIstDate } from "@/lib/time";
import { deleteExercise, finishExerciseUpload, prepareExerciseUpload, removeExerciseMedia, saveExercise, setExerciseActive } from "../../actions";

export const metadata: Metadata = { title: "Exercise" };

const NOTICES = {
  created: { text: "Exercise added. It stays hidden until you show it.", good: true },
  shown: { text: "Exercise shown in the app.", good: true },
  hidden: { text: "Exercise hidden from the app. Saved workouts keep it.", good: true },
  media_removed: { text: "Removed.", good: true },
  in_use: { text: "Members' workouts, records or programmes use this exercise, so it cannot be deleted. Hide it instead.", good: false },
  catalogue: { text: "Catalogue exercises are hidden, not deleted.", good: false },
  delete_failed: { text: "The exercise could not be deleted. Nothing was changed.", good: false },
  save_failed: { text: "The change could not be saved. Nothing was changed.", good: false },
  configuration: { text: "Server data access is not configured.", good: false },
  forbidden: { text: "Your role cannot make this change.", good: false },
};

function MediaCard({ item, exerciseId }: { item: ExerciseMediaItem; exerciseId: string }) {
  const isVideo = item.kind === "video_loop";
  return (
    <li className={styles.mediaCard}>
      <div className={styles.mediaFrame}>
        <span className={styles.mediaBadge}>{isVideo ? "Video" : `Photo ${item.position + 1}`}{!item.url && item.previewUrl ? " · Original" : ""}</span>
        {item.url && isVideo ? (
          <video src={item.url} muted loop playsInline controls preload="metadata" aria-label={item.alt || "Demonstration video"} />
        ) : item.previewUrl && !isVideo ? (
          // eslint-disable-next-line @next/next/no-img-element -- FITX's Storage copy or the catalogue original, sized by its frame
          <img src={item.previewUrl} alt={item.alt} loading="lazy" referrerPolicy="no-referrer" width={item.width ?? 400} height={item.height ?? 300} />
        ) : (
          <span>Original only, not yet copied to FITX storage</span>
        )}
      </div>
      <p className={styles.mediaCaption} title={`${item.attribution} · ${item.license}`}>{item.attribution} · {item.license}</p>
      <form action={removeExerciseMedia}>
        <input type="hidden" name="exerciseId" value={exerciseId} />
        <input type="hidden" name="mediaId" value={item.id} />
        <ConfirmSubmit label="Remove" confirmLabel="Confirm remove" small />
      </form>
    </li>
  );
}

export default async function ExercisePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("content.manage");
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  if (!EXERCISE_ID.test(id)) notFound();
  const query = await searchParams;
  const result = await getExercise(id);
  if (result.state === "not_found") notFound();
  if (result.state !== "ready") {
    return (
      <div className={styles.page}>
        <ContentHeader eyebrow="03 Workouts" title="Exercise" back={{ href: "/training", label: "Exercises" }} />
        <DataState state={result.state} />
      </div>
    );
  }
  const { exercise, media } = result;
  const stills = media.filter((item) => item.kind === "still");
  const videos = media.filter((item) => item.kind === "video_loop");
  const adminMade = exercise.id.startsWith("fitx-");
  const group = exercise.muscle_group ? MUSCLE_GROUP_LABELS[exercise.muscle_group as MuscleGroup] ?? humanise(exercise.muscle_group) : "No group";
  return (
    <div className={styles.page}>
      <ContentHeader
        eyebrow="03 Workouts"
        title={exercise.name}
        back={{ href: "/training", label: "Exercises" }}
        meta={`${group} · ${exercise.category ? CATEGORY_LABELS[exercise.category as keyof typeof CATEGORY_LABELS] ?? humanise(exercise.category) : "No category"} · ${exercise.id}`}
        actions={
          <>
            <Pill tone={exercise.is_active ? "good" : "neutral"}>{exercise.is_active ? "Shown" : "Hidden"}</Pill>
            <form action={setExerciseActive}>
              <input type="hidden" name="exerciseId" value={exercise.id} />
              <input type="hidden" name="active" value={String(!exercise.is_active)} />
              <input type="hidden" name="back" value="detail" />
              <SubmitButton quiet>{exercise.is_active ? "Hide" : "Show in app"}</SubmitButton>
            </form>
          </>
        }
      />
      <StateNotice code={pageNotice(query.state, actor.id)?.code} messages={NOTICES} />
      {exercise.merged_into && <p className={styles.hint}>A duplicate merged into {exercise.merged_into}; it stays hidden.</p>}

      <div className={styles.split}>
        <ExerciseForm
          action={saveExercise.bind(null, exercise.id)}
          creating={false}
          initial={{
            name: exercise.name,
            description: exercise.description,
            primary_muscle: exercise.primary_muscle,
            secondary_muscles: exercise.secondary_muscles,
            category: exercise.category,
            mechanic: exercise.mechanic,
            difficulty: exercise.difficulty,
            movement_pattern: exercise.movement_pattern,
            required_equipment: exercise.required_equipment,
            locations: exercise.locations,
            instructions: exercise.instructions,
            recommended_sets: exercise.recommended_sets,
            reps_min: exercise.reps_min,
            reps_max: exercise.reps_max,
            rest_seconds: exercise.rest_seconds,
            prescription_type: exercise.prescription_type,
            default_duration_seconds: exercise.default_duration_seconds,
            attribution: exercise.attribution,
          }}
        />

        <div className={styles.page}>
          <Section title="Video" note="A short, silent loop of one rep.">
            {videos.length ? <ul className={styles.mediaGrid}>{videos.map((item) => <MediaCard key={item.id} item={item} exerciseId={exercise.id} />)}</ul> : <Empty title="No video yet" />}
            <MediaUploader ownerId={exercise.id} kind="video_loop" prepare={prepareExerciseUpload} finish={finishExerciseUpload} defaultAlt={`${exercise.name}, one rep`} />
          </Section>
          <Section title="Photos" note="Start and end positions work best.">
            {stills.length ? <ul className={styles.mediaGrid}>{stills.map((item) => <MediaCard key={item.id} item={item} exerciseId={exercise.id} />)}</ul> : <Empty title="No photos yet" />}
            <MediaUploader ownerId={exercise.id} kind="still" prepare={prepareExerciseUpload} finish={finishExerciseUpload} defaultAlt={`${exercise.name}, photo ${stills.length + 1}`} />
          </Section>
          <Section title="Record">
            <dl className={`${styles.facts} ${styles.panel} ${styles.panelPad}`}>
              <div><dt>Id</dt><dd className={styles.mono}>{exercise.id}</dd></div>
              <div><dt>Source</dt><dd>{adminMade ? "Made in Admin" : exercise.source_ref ? "Free Exercise DB" : "FITX starter set"}</dd></div>
              <div><dt>Added</dt><dd>{formatIstDate(exercise.created_at) ?? "–"}</dd></div>
            </dl>
            {adminMade && (
              <form action={deleteExercise}>
                <input type="hidden" name="exerciseId" value={exercise.id} />
                <ConfirmSubmit label="Delete exercise" confirmLabel="Confirm delete, cannot be undone" />
              </form>
            )}
            {!adminMade && (
              <p className={styles.hint}>
                <Trash2 aria-hidden="true" size={13} /> Catalogue exercises can be hidden, not deleted.
              </p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
