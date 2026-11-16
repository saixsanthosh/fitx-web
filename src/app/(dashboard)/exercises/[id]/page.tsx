"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { useParams } from "next/navigation";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { ExerciseDemoPlayer } from "@/components/exercises/ExerciseDemoPlayer";
import { exerciseMediaQuery, mediaRowsFrom } from "@/components/exercises/media-loader";
import { rememberExercise } from "@/lib/domain/exercise-preferences";
import { columnList, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { createClient, SUPABASE_URL } from "@/lib/supabase/client";
import { CATALOG_BASE_COLUMNS, CATALOG_V2_COLUMNS, toCatalogExercise, type CatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import { equipmentFor, loadEquipmentProfiles, type EquipmentProfiles } from "@/lib/training/data";
import { equipmentLabel, expandOwnedEquipment, missingEquipment } from "@/lib/training/equipment";
import { resolveExerciseMedia, type ExerciseMedia } from "@/lib/training/media";
import { CATEGORY_LABELS, MUSCLE_GROUP_LABELS, type TrainingContext } from "@/lib/training/taxonomy";
import { capitalize, formatSeconds, readable, workPerSet } from "../_lib/format";

type Supabase = NonNullable<ReturnType<typeof createClient>>;
type DetailRow = CatalogRow & { description?: string | null; instructions?: string[] | null; attribution?: string | null };
type Detail = { exercise: CatalogExercise; description: string; instructions: string[]; attribution: string | null; media: ExerciseMedia };
type Loaded = { id: string; detail: Detail; error: "" } | { id: string; detail: null; error: string };
type Alternative = { id: string; name: string; primary_muscle: string };
type ExerciseHistory = { id: string; started_at: string; completedSets: number; topSet: string };
type Extras = { id: string; alternatives: Alternative[]; history: ExerciseHistory[] };
type EquipmentState = { profiles: EquipmentProfiles; legacyWords: string[]; failed: boolean };

const DETAIL_COLUMNS = [...CATALOG_BASE_COLUMNS, "description", "instructions", "attribution"];
const CONTEXT_NAMES: Record<TrainingContext, string> = { home: "Home", gym: "Gym" };

export default function ExerciseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [equipment, setEquipment] = useState<EquipmentState | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) { setLoaded({ id, detail: null, error: "Exercise information is unavailable in this environment." }); return; }
      const [auth, row, media] = await Promise.all([
        supabase.auth.getUser(),
        withOptionalColumns(CATALOG_V2_COLUMNS, (include) =>
          supabase.from("exercise_library").select(columnList(DETAIL_COLUMNS, CATALOG_V2_COLUMNS, include)).eq("id", id).eq("is_active", true).maybeSingle()),
        exerciseMediaQuery(supabase, id),
      ]);
      if (!active) return;
      const data = row.result.data as unknown as DetailRow | null;
      if (row.result.error || !data) {
        setLoaded({ id, detail: null, error: row.result.error
          ? "This exercise could not be loaded. Check your connection and try again."
          : "This exercise is not in the library. It may have been removed or merged into a similar movement." });
        return;
      }
      const exercise = toCatalogExercise(data);
      setLoaded({
        id,
        error: "",
        detail: {
          exercise,
          description: data.description?.trim() ?? "",
          instructions: (data.instructions ?? []).map((step) => step.trim()).filter(Boolean),
          attribution: data.attribution?.trim() || null,
          media: resolveExerciseMedia({ exerciseId: exercise.id, name: exercise.name, sourceRef: exercise.source_ref, rows: mediaRowsFrom(media), supabaseUrl: SUPABASE_URL }),
        },
      });
      const user = auth.data.user;
      setSignedIn(Boolean(user));
      if (user) rememberExercise(user.id, exercise.id);
      const [history, alternatives, lists] = await Promise.all([
        user ? loadHistory(supabase, user.id, exercise.id) : Promise.resolve([]),
        loadAlternatives(supabase, exercise.alternatives),
        user ? loadEquipment(supabase, user.id) : Promise.resolve(null),
      ]);
      if (!active) return;
      setExtras({ id, history, alternatives });
      if (lists) setEquipment(lists);
    })();
    return () => { active = false; };
  }, [id]);

  const current = loaded?.id === id ? loaded : null;
  if (!current) return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary" role="status">Loading exercise…</div>;
  if (!current.detail) return <EmptyState title="Exercise unavailable" description={current.error} action={<Link href="/exercises" className="fitx-button fitx-button-secondary"><ArrowLeft size={15} />Exercise library</Link>} />;

  const { exercise, description, instructions, attribution, media } = current.detail;
  const currentExtras = extras?.id === id ? extras : null;
  const timed = exercise.prescription_type === "time";

  return (
    <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <Link href="/exercises" className="inline-flex min-h-10 items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15} />Exercise library</Link>
      <PageHeading title={exercise.name} description={description || undefined} actions={<Link href={`/workouts?exercise=${encodeURIComponent(exercise.id)}`} className="fitx-button">Add to a workout<ArrowRight size={15} /></Link>} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)] lg:gap-5">
        <ExerciseDemoPlayer key={exercise.id} media={media} name={exercise.name} />
        <section className="fitx-panel p-4 sm:p-5" aria-labelledby="exercise-profile-heading">
          <p id="exercise-profile-heading" className="text-xs font-semibold uppercase tracking-[.14em] text-fitx-primary">Exercise profile</p>
          <p className="mt-2 text-lg font-semibold tracking-tight">{MUSCLE_GROUP_LABELS[exercise.muscle_group]}</p>
          <p className="mt-1 text-xs capitalize text-fitx-text-secondary">Primary muscle: {readable(exercise.primary_muscle)}</p>
          {exercise.secondary_muscles.length > 0 && <p className="mt-1 text-xs capitalize text-fitx-text-secondary">Also involved: {exercise.secondary_muscles.map(readable).join(", ")}</p>}
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Exercise details">
            {[CATEGORY_LABELS[exercise.category], capitalize(exercise.difficulty), exercise.locations.includes("home") ? "Home or gym" : "Gym"]
              .map((value) => <li key={value} className="rounded-sm border border-fitx-border px-2 py-1 text-[11px] text-fitx-text-secondary">{value}</li>)}
          </ul>

          <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-3 border-y border-fitx-divider py-3">
            <Stat label="Suggested sets" value={`${exercise.recommended_sets} sets`} />
            <Stat label={timed ? "Time per set" : "Reps per set"} value={workPerSet(exercise)} />
            <Stat label="Rest guide" value={formatSeconds(exercise.rest_seconds)} />
            <Stat label="Mechanic" value={exercise.mechanic === "compound" ? "Compound" : exercise.mechanic === "isolation" ? "Isolation" : "Not applicable"} />
          </dl>

          <EquipmentSection required={exercise.required_equipment} equipment={equipment} signedIn={signedIn} />

          {!exercise.curated && <p className="mt-3 text-xs leading-5 text-fitx-text-secondary">Category, equipment and prescription are estimated from older catalogue data until FITX’s exercise catalogue update is applied.</p>}

          <div className="mt-5">
            <h2 className="text-sm font-semibold">Movement instructions</h2>
            {instructions.length
              ? <ol className="mt-3 space-y-3">{instructions.map((instruction, index) => <li key={`${index}-${instruction}`} className="flex gap-3 text-sm leading-6 text-fitx-text-secondary"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm bg-fitx-surface-variant text-[11px] font-semibold text-fitx-primary-text">{String(index + 1).padStart(2, "0")}</span><span>{instruction}</span></li>)}</ol>
              : <p className="mt-2 rounded-lg border border-dashed border-fitx-border px-3 py-3 text-sm leading-6 text-fitx-text-secondary">No written steps are recorded for this exercise yet. If the movement is new to you, start light or choose a related movement you know.</p>}
          </div>
          <div className="mt-4 flex items-start gap-2 border-t border-fitx-divider pt-3 text-xs leading-5 text-fitx-text-secondary"><Info size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-primary" />General guidance only. Use a controlled range of motion, adjust the load to your experience, and stop if movement causes pain.</div>
        </section>
      </div>

      {(currentExtras?.alternatives.length ?? 0) > 0 && <section className="border-t border-fitx-divider pt-4"><div className="mb-3"><h2 className="text-sm font-semibold">Related movements</h2><p className="mt-1 text-xs text-fitx-text-secondary">Other exercises linked in this catalogue record.</p></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{currentExtras?.alternatives.map((alternative) => <Link key={alternative.id} href={`/exercises/${alternative.id}`} className="fitx-panel flex min-h-14 items-center justify-between gap-3 px-3 py-3 text-sm hover:border-fitx-primary/35"><span className="min-w-0"><span className="block truncate font-medium">{alternative.name}</span><span className="mt-1 block capitalize text-[11px] text-fitx-text-secondary">{readable(alternative.primary_muscle)}</span></span><ArrowRight size={15} aria-hidden="true" className="shrink-0 text-fitx-primary" /></Link>)}</div></section>}
      <section className="border-t border-fitx-divider pt-4"><div className="mb-3"><h2 className="text-sm font-semibold">Your recent sessions</h2><p className="mt-1 text-xs text-fitx-text-secondary">Completed workout records for this movement.</p></div>{!currentExtras ? <p className="rounded-lg border border-fitx-border px-4 py-4 text-sm text-fitx-text-secondary" role="status">Loading your history…</p> : currentExtras.history.length ? <div className="fitx-panel divide-y divide-fitx-divider px-4">{currentExtras.history.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><p className="font-medium">{new Date(row.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p><p className="mt-1 text-xs text-fitx-text-secondary">{row.completedSets} completed sets</p></div><span className="text-xs font-semibold tabular-nums text-fitx-primary-text">Top set · {row.topSet}</span></div>)}</div> : <p className="rounded-lg border border-fitx-border px-4 py-4 text-sm text-fitx-text-secondary">No completed sets for this movement yet. Your history will appear here after you log one.</p>}</section>
      {attribution && <p className="text-[11px] leading-5 text-fitx-text-secondary">Exercise text source: {attribution}.</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[10px] uppercase tracking-[.1em] text-fitx-text-secondary">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>;
}

/** What the exercise needs, and what is missing from the user's Home and Gym lists. */
function EquipmentSection({ required, equipment, signedIn }: { required: string[]; equipment: EquipmentState | null; signedIn: boolean }) {
  const lists = equipment ? (["home", "gym"] as const).map((context) => {
    const list = equipmentFor(equipment.profiles, context, equipment.legacyWords);
    return { context, saved: list.saved, missing: missingEquipment(required, expandOwnedEquipment(list.keys)) };
  }) : null;
  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold">Equipment</h2>
      <p className="mt-1 text-sm text-fitx-text-secondary">{required.length ? `Needs: ${required.map(equipmentLabel).join(", ")}` : "No equipment needed: body weight, the floor and a wall."}</p>
      {lists && (
        <ul className="mt-2 space-y-1.5 text-sm">
          {lists.map(({ context, missing }) => (
            <li key={context} className="flex items-start gap-2">
              <span className="mt-px w-12 shrink-0 text-[11px] font-semibold uppercase tracking-[.08em] text-fitx-text-secondary">{CONTEXT_NAMES[context]}</span>
              <span className={missing.length ? "text-fitx-text" : "text-fitx-text-secondary"}>
                {missing.length ? `Missing at ${context === "home" ? "home" : "your gym"}: ${missing.map(equipmentLabel).join(", ")}` : `You have what this needs ${context === "home" ? "at home" : "at your gym"}.`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {lists && equipment && <p className="mt-2 text-xs leading-5 text-fitx-text-secondary">{listSourceNote(lists, equipment)} {equipment.profiles.available
        ? <Link href="/workouts" className="font-medium text-fitx-primary-text underline underline-offset-2">Edit your lists on the Workouts page</Link>
        : "Saving your own lists becomes available with the next FITX update."}</p>}
      {!lists && signedIn && <p className="mt-2 text-xs text-fitx-text-secondary" role="status">Checking your Home and Gym equipment…</p>}
    </div>
  );
}

function listSourceNote(lists: Array<{ context: TrainingContext; saved: boolean }>, equipment: EquipmentState) {
  if (equipment.failed) return "Your saved equipment lists could not be loaded, so this uses starting lists.";
  const [home, gym] = lists;
  if (home.saved && gym.saved) return "Checked against your saved Home and Gym lists.";
  if (!home.saved && !gym.saved) return "Checked against starting lists (your profile’s equipment at home, a full commercial gym) until you save your own.";
  return home.saved ? "Checked against your saved Home list and a starting Gym list (a full commercial gym)." : "Checked against a starting Home list from your profile and your saved Gym list.";
}

async function loadEquipment(supabase: Supabase, userId: string): Promise<EquipmentState> {
  const [lists, preferences] = await Promise.all([
    loadEquipmentProfiles(supabase, userId),
    supabase.from("user_preferences").select("equipment").eq("user_id", userId).maybeSingle(),
  ]);
  const words = (preferences.data as { equipment?: string[] | null } | null)?.equipment;
  return { profiles: lists.profiles, legacyWords: Array.isArray(words) ? words : [], failed: Boolean(lists.error) };
}

async function loadAlternatives(supabase: Supabase, ids: string[]): Promise<Alternative[]> {
  if (!ids.length) return [];
  const related = await supabase.from("exercise_library").select("id,name,primary_muscle").in("id", ids).eq("is_active", true).limit(8);
  return (related.data || []) as Alternative[];
}

/** The user's completed sessions with this exercise, newest first, with each session's top set. */
async function loadHistory(supabase: Supabase, userId: string, exerciseId: string): Promise<ExerciseHistory[]> {
  const sessionExerciseResult = await supabase.from("workout_session_exercises").select("id,session_id,created_at").eq("user_id", userId).eq("exercise_id", exerciseId).order("created_at", { ascending: false }).limit(12);
  if (sessionExerciseResult.error || !sessionExerciseResult.data?.length) return [];
  const loggedRows = sessionExerciseResult.data as Array<{ id: string; session_id: string; created_at: string }>;
  const sessionsResult = await supabase.from("workout_sessions").select("id,started_at").eq("user_id", userId).eq("status", "completed").in("id", [...new Set(loggedRows.map((row) => row.session_id))]).order("started_at", { ascending: false }).limit(8);
  if (sessionsResult.error || !sessionsResult.data?.length) return [];
  const completedSessions = sessionsResult.data as Array<{ id: string; started_at: string }>;
  const completedExerciseRows = loggedRows.filter((row) => completedSessions.some((session) => session.id === row.session_id));
  const setResult = await supabase.from("workout_sets").select("session_exercise_id,reps,weight_kg,duration_seconds,completed_at").eq("user_id", userId).in("session_exercise_id", completedExerciseRows.map((row) => row.id)).not("completed_at", "is", null);
  if (setResult.error) return [];
  const loggedSets = (setResult.data || []) as Array<{ session_exercise_id: string; reps: number | null; weight_kg: number; duration_seconds: number | null; completed_at: string | null }>;
  return completedSessions.flatMap((session) => {
    const movementIds = completedExerciseRows.filter((row) => row.session_id === session.id).map((row) => row.id);
    const sets = loggedSets.filter((set) => movementIds.includes(set.session_exercise_id) && (Number(set.reps) > 0 || Number(set.duration_seconds) > 0));
    if (!sets.length) return [];
    const lifted = sets.filter((set) => Number(set.reps) > 0);
    if (lifted.length) {
      const best = lifted.reduce((winner, set) => Number(set.weight_kg) > Number(winner.weight_kg) || (Number(set.weight_kg) === Number(winner.weight_kg) && Number(set.reps) > Number(winner.reps)) ? set : winner);
      return [{ id: session.id, started_at: session.started_at, completedSets: sets.length, topSet: Number(best.weight_kg) > 0 ? `${Number(best.weight_kg)} kg × ${best.reps}` : `${best.reps} reps` }];
    }
    const maxDuration = Math.max(...sets.map((set) => Number(set.duration_seconds || 0)));
    return [{ id: session.id, started_at: session.started_at, completedSets: sets.length, topSet: `${maxDuration}s timed` }];
  });
}
