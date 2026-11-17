"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadExerciseHistory, type ExerciseSession } from "@/lib/training/exercise-history";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import { HISTORY_LOADS, historyBasis, nextHistoryLoad } from "@/lib/training/exercise-progress";

export type ExerciseHistoryView =
  /** Not asked for yet (History and Progress have not been opened). */
  | { status: "idle" }
  | { status: "signed-out" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
    status: "ready";
    /** Completed sessions with this exercise, newest first. */
    sessions: ExerciseSession[];
    /** How many sessions were asked for: when `sessions` fills it, older ones may exist. */
    limit: number;
    /** The read stopped before the oldest rows (loadExerciseHistory `truncated`): older sessions may exist. */
    truncated: boolean;
    /** Reads more sessions, when a larger read is left (or tries the failed one again). */
    loadMore: (() => void) | null;
    loadingMore: boolean;
    /** The last larger read failed; `loadMore` tries it again. */
    moreFailed: boolean;
  };

type Answer = { key: string; sessions: ExerciseSession[] | null };

/**
 * The member's completed sessions with the exercise (exercise-history.ts loadExerciseHistory, the one loader of
 * contract C8), read once History or Progress is first opened and shared by both. `userId` undefined: not known
 * yet; null: signed out.
 */
export function useExerciseHistory(wanted: boolean, userId: string | null | undefined, exerciseId: string): ExerciseHistoryView {
  const [limit, setLimit] = useState<number>(HISTORY_LOADS[0]);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  /** The newest sessions read successfully, kept on screen while a larger read runs. */
  const [shown, setShown] = useState<{ sessions: ExerciseSession[]; limit: number; truncated: boolean } | null>(null);
  const key = `${userId ?? ""}|${exerciseId}|${limit}|${attempt}`;

  useEffect(() => {
    if (!wanted || !userId) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      const history = supabase
        ? await loadExerciseHistory(supabase, userId, exerciseId, { sessions: limit })
        : { error: new Error("Supabase is not configured"), byExercise: new Map<string, ExerciseSession[]>(), truncated: false };
      if (!active) return;
      const sessions = history.error ? null : history.byExercise.get(survivingExerciseId(exerciseId)) ?? [];
      setAnswer({ key, sessions });
      if (sessions) setShown({ sessions, limit, truncated: history.truncated });
    })();
    return () => { active = false; };
  }, [wanted, userId, exerciseId, limit, key]);

  if (!wanted) return { status: "idle" };
  if (userId === null) return { status: "signed-out" };
  const retry = () => setAttempt((value) => value + 1);
  const current = answer?.key === key ? answer : null;
  const failed = current !== null && current.sessions === null;
  if (!shown) return failed ? { status: "error", retry } : { status: "loading" };
  // A larger read that failed keeps the sessions already shown and can be tried again.
  if (failed) return { status: "ready", sessions: shown.sessions, limit: shown.limit, truncated: shown.truncated, loadingMore: false, moreFailed: true, loadMore: retry };
  // A larger read also reads more rows, so it can reach sessions a cut-off read did not.
  const next = historyBasis(shown.sessions.length, shown.limit, shown.truncated).capped ? nextHistoryLoad(shown.limit) : null;
  return {
    status: "ready",
    sessions: shown.sessions,
    limit: shown.limit,
    truncated: shown.truncated,
    loadingMore: current === null,
    moreFailed: false,
    loadMore: next ? () => setLimit(next) : null,
  };
}
