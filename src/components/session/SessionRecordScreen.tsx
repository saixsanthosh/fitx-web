"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Camera, Check, Info, Play, RotateCcw, Trophy } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import { StatStrip } from "@/components/training/StatStrip";
import { formatHistorySet } from "@/app/(dashboard)/workouts/active/_lib/last-time";
import {
  NOTE_MAX_LENGTH, countedSets, loadSessionRecord, recordLine, recordMuscles, recordStats, repeatPlanFrom, saveSessionNote, statusBadge, stripStats,
  type RecordExercise, type RecordSet, type SessionRecord,
} from "@/app/(dashboard)/workouts/history/_lib/session-record";
import { createClient } from "@/lib/supabase/client";
import { regionLabel, exerciseRegions } from "@/lib/training/anatomy";
import { createPlanRecord } from "@/lib/training/plans";
import { SessionMuscles } from "./SessionMuscles";

type Loaded = { id: string; userId: string; record: SessionRecord } | { id: string; error: "missing" | "failed" | "signed-out" | "offline" };

const dateLine = (startedAt: string, completedAt: string | null) => {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return "";
  const day = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const end = completedAt ? new Date(completedAt) : null;
  return end && !Number.isNaN(end.getTime()) ? `${day} · ${time.format(start)}–${time.format(end)}` : `${day} · started ${time.format(start)}`;
};

/** A saved set in words: "60 kg × 8", "12 reps", "45 s" (the live workout's wording). */
const setText = (set: RecordSet, timed: boolean) => formatHistorySet({ setNumber: set.set_number, reps: set.reps, weightKg: set.weight_kg, durationSeconds: set.duration_seconds, completedAt: set.completed_at ?? "" }, timed);

/**
 * One workout's record (/workouts/history/[id]): when it was, its totals, the muscles it trained on the body map,
 * every exercise with the sets logged, its note and the records it still holds. An abandoned workout opens read-only
 * and is marked as not counted. "Repeat this workout" saves a copy to the member's plans.
 */
export function SessionRecordScreen({ id }: { id: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [repeating, setRepeating] = useState(false);
  const [repeatError, setRepeatError] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) { setLoaded({ id, error: "offline" }); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoaded({ id, error: "signed-out" }); return; }
    const result = await loadSessionRecord(supabase, auth.user.id, id);
    if (result.status === "found") setLoaded({ id, userId: auth.user.id, record: result.record });
    else setLoaded({ id, error: result.status === "missing" ? "missing" : "failed" });
  }, [id]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const current = loaded?.id === id ? loaded : null;
  if (!current) return <div role="status" className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading the workout record…</div>;
  if ("error" in current) {
    const copy = {
      missing: { title: "Workout not found", description: "There’s no workout with this link in your history. It may have been removed." },
      failed: { title: "Workout record unavailable", description: "This workout couldn’t be loaded. Check your connection and try again." },
      "signed-out": { title: "Sign in to see this workout", description: "Workout records are private to your account." },
      offline: { title: "Workout record unavailable", description: "FITX is not connected to its database in this environment." },
    }[current.error];
    return <EmptyState title={copy.title} description={copy.description} action={<div className="flex flex-wrap justify-center gap-2">
      {current.error === "failed" && <button type="button" onClick={() => { setLoaded(null); void load(); }} className="fitx-button">Try again</button>}
      <Link href="/workouts/history" className="fitx-button fitx-button-secondary"><ArrowLeft size={15} aria-hidden="true" />Workout history</Link>
    </div>} />;
  }

  const { record, userId } = current;
  const { session } = record;
  if (session.status === "in_progress") {
    return <EmptyState title="This workout is still in progress" description="Its record is ready once you finish it." action={<Link href={`/workouts/active?session=${encodeURIComponent(session.id)}`} className="fitx-button"><Play size={15} aria-hidden="true" />Resume the workout</Link>} />;
  }
  const counted = session.status === "completed";
  const badge = statusBadge(session.status);
  const stats = recordStats(record);
  const muscles = counted ? recordMuscles(record) : null;
  const repeatPreview = repeatPlanFrom(record);

  async function repeat() {
    const supabase = createClient();
    if (!supabase || repeating) return;
    setRepeating(true);
    setRepeatError("");
    if (record.musclesFailed) { setRepeating(false); setRepeatError("The exercise library couldn’t be loaded, so this workout can’t be copied yet. Reload the page and try again."); return; }
    // The copy keeps the original plan's split and place when that plan still exists, else where the member trains.
    const original = session.plan_id ? await supabase.from("workout_plans").select("split,workout_location").eq("id", session.plan_id).eq("user_id", userId).maybeSingle() : null;
    const plan = (original?.data ?? null) as { split?: string | null; workout_location?: string | null } | null;
    let location = plan?.workout_location ?? null;
    if (!location) {
      const preferences = await supabase.from("user_preferences").select("workout_location").eq("user_id", userId).maybeSingle();
      location = (preferences.data as { workout_location?: string | null } | null)?.workout_location ?? null;
    }
    const copy = repeatPlanFrom(record, { split: plan?.split ?? null, location });
    if (!copy.exercises.length) { setRepeating(false); setRepeatError("None of this workout’s exercises are in the library now, so it can’t be repeated."); return; }
    const created = await createPlanRecord(supabase, userId, copy.plan, copy.exercises, { includeTargets: record.targetsIncluded });
    if (created.error || !created.planId) { setRepeating(false); setRepeatError("The copy couldn’t be saved to your plans. Check your connection and try again."); return; }
    router.push(`/workouts?plan=${encodeURIComponent(created.planId)}`);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
      <Link href="/workouts/history" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15} aria-hidden="true" />Workout history</Link>
      <PageHeading
        title={session.name}
        description={<>{dateLine(session.started_at, session.completed_at)}{badge && <span className="ml-2 inline-flex rounded-full border border-fitx-border bg-fitx-surface-variant px-2.5 py-0.5 align-middle text-xs font-semibold text-fitx-text">{badge}</span>}</>}
        actions={<button type="button" onClick={() => void repeat()} disabled={repeating} className="fitx-button min-h-11"><RotateCcw size={15} aria-hidden="true" />{repeating ? "Copying…" : "Repeat this workout"}</button>}
      />
      {repeatError && <p role="alert" className="fitx-alert fitx-alert-danger">{repeatError}</p>}
      <p className="-mt-3 text-xs text-fitx-text-secondary">Repeat saves a copy to your plans, ready to start.{!record.musclesFailed && repeatPreview.leftOut > 0 && ` ${repeatPreview.leftOut === 1 ? "1 exercise is" : `${repeatPreview.leftOut} exercises are`} no longer in the library and will be left out.`}</p>

      {!counted && (
        <p className="flex items-start gap-2 rounded-xl border border-fitx-border bg-fitx-surface px-4 py-3 text-sm text-fitx-text-secondary">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-info" />
          <span>You stopped this workout before finishing it, so it isn’t counted in your progress, records or muscle map. The sets you completed are kept here.</span>
        </p>
      )}

      <section aria-labelledby="record-totals" className="space-y-3">
        <h2 id="record-totals" className="text-base font-semibold">Totals</h2>
        <StatStrip label="Workout totals" stats={stripStats(stats, counted ? ["elapsed", "active", "volume", "sets"] : ["active", "volume", "sets", "exercises"])} />
      </section>

      {counted && muscles && (
        <section aria-labelledby="record-muscles" className="fitx-panel p-4 sm:p-6">
          <h2 id="record-muscles" className="text-base font-semibold">Muscles trained</h2>
          <p className="mb-4 mt-1 text-xs text-fitx-text-secondary">Highlighted by how much of this workout each muscle took.</p>
          <SessionMuscles summary={muscles} failed={record.musclesFailed} />
        </section>
      )}

      {counted && record.records && record.records.length > 0 && (
        <section aria-labelledby="record-bests" className="fitx-panel p-4 sm:p-5">
          <h2 id="record-bests" className="flex items-center gap-2 text-base font-semibold"><Trophy size={17} aria-hidden="true" className="text-fitx-primary" />Personal records this workout holds</h2>
          <ul className="m-0 mt-3 list-none space-y-1.5 p-0 text-sm">{record.records.map((item) => <li key={item.exercise_name}>{recordLine(item)}{item.estimated_one_rep_max > 0 && <span className="text-fitx-text-secondary"> · ≈ {Math.round(item.estimated_one_rep_max * 10) / 10} kg estimated 1RM</span>}</li>)}</ul>
          <p className="m-0 mt-3 text-xs text-fitx-text-secondary">A record moves to a newer workout when you beat it, so this list shows only the ones this workout still holds. The 1RM is an estimate worked out from the set, not a lift you did.</p>
        </section>
      )}

      <section aria-labelledby="record-exercises" className="space-y-3">
        <h2 id="record-exercises" className="text-base font-semibold">Exercises <span className="font-normal text-fitx-text-secondary">· {stats.exercisesDone} of {stats.exercisesPlanned} done</span></h2>
        {record.exercises.length
          ? <ol className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2 lg:items-start">{record.exercises.map((exercise, index) => <ExerciseCard key={exercise.id} exercise={exercise} position={index + 1} libraryFailed={record.musclesFailed} />)}</ol>
          : <EmptyState title="No exercises" description="This workout has no exercises recorded." />}
      </section>

      <SessionNote key={session.id} record={record} userId={userId} editable={counted} />
    </div>
  );
}

function ExerciseCard({ exercise, position, libraryFailed }: { exercise: RecordExercise; position: number; libraryFailed: boolean }) {
  const sets = countedSets(exercise);
  const timed = exercise.target_duration_seconds !== null;
  const notDone = exercise.sets.length - sets.length;
  const regions = exercise.library ? exerciseRegions(exercise.library.primary_muscle, exercise.library.secondary_muscles) : null;
  const libraryId = exercise.library?.id ?? null;
  return (
    <li className="fitx-panel p-4 sm:p-5">
      <div className="flex items-start gap-3">
        {libraryId
          ? <ExerciseThumb exerciseId={libraryId} name={exercise.name} sourceRef={exercise.sourceRef} equipment={exercise.equipment ?? undefined} size="md" />
          : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-fitx-surface-variant font-mono text-sm text-fitx-text-secondary">{String(position).padStart(2, "0")}</span>}
        <div className="min-w-0 flex-1">
          <p className="m-0 font-mono text-[11px] text-fitx-text-secondary">{String(position).padStart(2, "0")}</p>
          <h3 className="m-0 text-base font-semibold leading-snug">
            {libraryId ? <Link href={`/exercises/${encodeURIComponent(libraryId)}`} className="hover:text-fitx-primary-text hover:underline">{exercise.name}</Link> : exercise.name}
          </h3>
          <p className="m-0 mt-1 text-xs text-fitx-text-secondary">
            {regions && regions.primary.length
              ? <>{regions.primary.map(regionLabel).join(", ")}{regions.secondary.length ? <> · also {regions.secondary.map((region) => regionLabel(region).toLowerCase()).join(", ")}</> : null}</>
              : !exercise.exercise_id ? "Added by name, not from the exercise library" : libraryFailed ? "Its muscles couldn’t be loaded" : "Not in the exercise library now, so its muscles aren’t shown"}
          </p>
        </div>
      </div>
      {sets.length ? (
        <table className="mt-4 w-full border-collapse text-sm">
          <caption className="sr-only">Sets of {exercise.name}</caption>
          <thead><tr className="text-left text-[11px] font-semibold uppercase tracking-[.08em] text-fitx-text-secondary"><th scope="col" className="w-14 pb-2 font-semibold">Set</th><th scope="col" className="pb-2 font-semibold">Logged</th><th scope="col" className="pb-2 text-right font-semibold"><span className="sr-only">Notes</span></th></tr></thead>
          <tbody>{sets.map((set) => (
            <tr key={set.id} className="border-t border-fitx-divider">
              <td className="py-2.5 tabular-nums text-fitx-text-secondary">{String(set.set_number).padStart(2, "0")}</td>
              <td className="py-2.5 font-semibold tabular-nums">{setText(set, timed)}</td>
              <td className="py-2.5 text-right">{set.rep_source === "camera" && <span className="inline-flex items-center gap-1 rounded-full bg-fitx-surface-variant px-2 py-0.5 text-xs font-semibold"><Camera size={12} aria-hidden="true" />Counted by camera</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p className="m-0 mt-4 rounded-lg border border-dashed border-fitx-border px-3 py-3 text-sm text-fitx-text-secondary">No sets logged for this exercise.</p>}
      {notDone > 0 && sets.length > 0 && <p className="m-0 mt-2 text-xs text-fitx-text-secondary">{notDone === 1 ? "1 planned set wasn’t done." : `${notDone} planned sets weren’t done.`}</p>}
    </li>
  );
}

/** The workout's note: written after a completed workout (at most 500 characters); an abandoned one is read-only. */
function SessionNote({ record, userId, editable }: { record: SessionRecord; userId: string; editable: boolean }) {
  const [saved, setSaved] = useState(record.session.notes ?? "");
  const [draft, setDraft] = useState(record.session.notes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  if (!editable && !saved) return null;
  const changed = draft.trim() !== saved.trim();

  async function save() {
    const supabase = createClient();
    if (!supabase) return;
    setState("saving");
    const result = await saveSessionNote(supabase, userId, record.session.id, draft);
    if (result.error) { setState("failed"); return; }
    setSaved(result.notes ?? "");
    setDraft(result.notes ?? "");
    setState("saved");
  }

  return (
    <section aria-labelledby="record-note" className="fitx-panel p-4 sm:p-5">
      <h2 id="record-note" className="text-base font-semibold">Note</h2>
      {editable ? (
        <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label htmlFor="record-note-text" className="text-xs text-fitx-text-secondary">How it went, what to change next time. Only you can see it.</label>
          <textarea id="record-note-text" className="fitx-field" maxLength={NOTE_MAX_LENGTH} value={draft} readOnly={state === "saving"} aria-busy={state === "saving"} onChange={(event) => { setDraft(event.target.value); setState("idle"); }} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs tabular-nums text-fitx-text-secondary">{draft.length}/{NOTE_MAX_LENGTH}</span>
            <div className="flex items-center gap-3">
              <span role="status" className="text-xs text-fitx-text-secondary">{state === "saved" ? <span className="inline-flex items-center gap-1"><Check size={13} aria-hidden="true" />Saved</span> : state === "failed" ? "The note couldn’t be saved. Try again." : ""}</span>
              <button type="submit" disabled={!changed || state === "saving"} className="fitx-button fitx-button-secondary min-h-11 px-4 text-sm">{state === "saving" ? "Saving…" : "Save note"}</button>
            </div>
          </div>
        </form>
      ) : <p className="m-0 mt-2 whitespace-pre-line text-sm text-fitx-text-secondary">{saved}</p>}
    </section>
  );
}
