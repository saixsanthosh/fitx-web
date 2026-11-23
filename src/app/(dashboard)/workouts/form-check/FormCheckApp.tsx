"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { recordHref } from "@/app/(dashboard)/workouts/history/_lib/session-record";
import { FormCoach } from "@/components/form-coach/FormCoach";
import { FORM_CHECK_PATH } from "@/lib/home-workout/route";
import type { CoachSummary } from "@/lib/form-rules/session";
import { homeExercise } from "@/lib/home-workout/catalog";
import type { LoggedSet } from "@/lib/home-workout/log";
import { readSets, setFromSummary, writeSets } from "@/lib/home-workout/log";
import type { SaveDb } from "@/lib/home-workout/save";
import { buildWorkoutRecord, saveWorkoutRecord, tabUnfinishedSaves } from "@/lib/home-workout/save";
import { createClient } from "@/lib/supabase/client";
import { ExercisePicker } from "./ExercisePicker";
import { FormCheckFacts } from "./FormCheckFacts";
import { FormCheckHero } from "./FormCheckHero";
import type { SaveState } from "./TodaySets";
import { TodaySets } from "./TodaySets";

const session = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

/**
 * Home workout: the exercise list, or one exercise (kept in the address, so it can be linked to)
 * from its demonstration to the camera and its results. Finished sets collect under Today until
 * they are saved to workout history.
 */
export function FormCheckApp() {
  const params = useSearchParams();
  const router = useRouter();
  const exercise = homeExercise(params.get("exercise"));
  const [sets, setSets] = useState<LoggedSet[]>([]);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  /** The number under Today of the set just finished, or null when nothing was counted. */
  const [lastLogged, setLastLogged] = useState<number | null>(null);

  /** The signed-in account the tab's sets belong to (null until known). */
  const owner = useRef<string | null>(null);

  // Today's unsaved sets of this account come back after a reload (this tab only).
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = (await createClient()?.auth.getSession()) ?? { data: { session: null } };
      const userId = data.session?.user.id ?? null;
      if (!live || !userId) return;
      owner.current = userId;
      const stored = readSets(session(), Date.now(), userId);
      if (stored.length) setSets((current) => (current.length ? current : stored));
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const update = useCallback((next: (current: LoggedSet[]) => LoggedSet[]) => {
    setSets((current) => {
      const value = next(current);
      writeSets(session(), value, Date.now(), owner.current);
      return value;
    });
  }, []);

  const onFinished = useCallback((summary: CoachSummary) => {
    const rule = homeExercise(summary.exerciseId);
    if (!rule) return;
    const now = Date.now();
    const set = setFromSummary(summary, rule.rule.name, now, `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
    if (!set) {
      setLastLogged(null);
      return;
    }
    setSave({ status: "idle" });
    update((current) => {
      setLastLogged(current.length + 1);
      return [...current, set];
    });
  }, [update]);

  const onSave = async () => {
    const record = buildWorkoutRecord(sets, (id) => homeExercise(id)?.rule.libraryIds[0] ?? null);
    if (!record) return;
    const db = createClient();
    if (!db) {
      setSave({ status: "error", message: "Saving isn’t available right now." });
      return;
    }
    setSave({ status: "saving" });
    const { data } = await db.auth.getUser();
    if (!data.user) {
      setSave({ status: "error", message: "Sign in again to save your workout." });
      return;
    }
    const outcome = await saveWorkoutRecord(db as unknown as SaveDb, data.user.id, record, tabUnfinishedSaves(session()));
    if (!outcome.ok) {
      setSave({ status: "error", message: outcome.message });
      return;
    }
    update(() => []);
    // The set's "save the workout when you're done" note no longer applies.
    setLastLogged(null);
    setSave({ status: "saved", href: recordHref(outcome.sessionId) });
  };

  const today = <TodaySets sets={sets} save={save} onSave={() => void onSave()} onRemove={(id) => update((current) => current.filter((set) => set.id !== id))} />;

  if (!exercise) {
    return (
      <div className="space-y-6 sm:space-y-8">
        <FormCheckHero />
        <FormCheckFacts />
        {today}
        <ExercisePicker />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="sr-only">AI Form Check</h1>
      <FormCoach
        key={exercise.id}
        rule={exercise.rule}
        mode="practice"
        onChangeExercise={() => router.push(FORM_CHECK_PATH, { scroll: true })}
        onFinished={onFinished}
        setNote={lastLogged ? `Kept under Today as set ${lastLogged}. Save the workout when you’re done.` : null}
      />
      {today}
    </div>
  );
}
