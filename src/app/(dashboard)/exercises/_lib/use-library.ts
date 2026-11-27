import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isAuthOutage } from "@/lib/account/deletion";
import { loadSavedExercises, setExerciseSaved, withExerciseSaved, type SavedStore } from "@/lib/domain/exercise-preferences";
import { createClient } from "@/lib/supabase/client";
import type { CatalogExercise } from "@/lib/training/catalog";
import { loadEquipmentProfiles, type EquipmentProfiles } from "@/lib/training/data";
import { LEVELS, type Level, type TrainingContext } from "@/lib/training/taxonomy";
import { loadLightCatalogue } from "./catalogue";
import { afterProfilesReload, withSavedList } from "./equipment-lists";
import { savedToggleProblem, type SavedToggle } from "./saved-toggle";

/**
 * Data hooks shared by the exercise library and Browse by muscle (client components): the page's URL, the light
 * catalogue, the member's equipment lists and level, and their saved exercises.
 */

// ---------------------------------------------------------------- the URL

function subscribeToUrl(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

/** The page's query string ("?q=…"), kept in step with replaceSearch and Back/Forward. */
export function useUrlSearch(): string {
  return useSyncExternalStore(subscribeToUrl, () => window.location.search, () => "");
}

/** Replaces the query string without adding a history entry, and tells useUrlSearch. */
export function replaceSearch(search: string) {
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// ---------------------------------------------------------------- the catalogue

export type CatalogueState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; exercises: CatalogExercise[]; curated: boolean };

/** The whole active catalogue (light), loaded once per page; `retry` after an error. */
export function useCatalogue(): { catalogue: CatalogueState; retry: () => void } {
  const [catalogue, setCatalogue] = useState<CatalogueState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    if (!supabase) {
      void Promise.resolve().then(() => { if (active) setCatalogue({ status: "error" }); });
      return () => { active = false; };
    }
    void loadLightCatalogue(supabase).then((result) => {
      if (!active) return;
      setCatalogue(result.error ? { status: "error" } : { status: "ready", exercises: result.exercises, curated: result.curated });
    });
    return () => { active = false; };
  }, [attempt]);
  const retry = useCallback(() => { setCatalogue({ status: "loading" }); setAttempt((value) => value + 1); }, []);
  return { catalogue, retry };
}

// ---------------------------------------------------------------- the member

export type LibraryAccount =
  | { status: "loading" }
  | { status: "unavailable" }
  /** Sign-in could not be checked (Supabase Auth unreachable); `retry` asks again. */
  | { status: "error" }
  | { status: "signed-out" }
  | {
    status: "ready";
    userId: string;
    profiles: EquipmentProfiles;
    /** Equipment words from onboarding or Profile, for the starting Home list. */
    legacyWords: string[];
    level: Level | null;
    /** True when the saved equipment lists could not be read (a starting list is used meanwhile). */
    failed: boolean;
  };

/**
 * The signed-in member, their saved Home and Gym lists and their level. `reloadProfiles` after saving a list (pass
 * what was saved, so it shows even if the read back fails); `retry` after an "error".
 */
export function useLibraryAccount(): {
  account: LibraryAccount;
  reloadProfiles: (saved?: { context: TrainingContext; keys: readonly string[] }) => Promise<void>;
  retry: () => void;
} {
  const [account, setAccount] = useState<LibraryAccount>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const userIdRef = useRef("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) { if (active) setAccount({ status: "unavailable" }); return; }
      const { data, error } = await supabase.auth.getUser().catch((caught: unknown) => ({ data: { user: null }, error: caught }));
      if (!active) return;
      // An outage is not a sign-out: the member is told and can try again.
      if (isAuthOutage(error)) { userIdRef.current = ""; setAccount({ status: "error" }); return; }
      const uid = data.user?.id ?? "";
      userIdRef.current = uid;
      if (!uid) { setAccount({ status: "signed-out" }); return; }
      const [lists, preferences] = await Promise.all([
        loadEquipmentProfiles(supabase, uid),
        supabase.from("user_preferences").select("equipment,fitness_level").eq("user_id", uid).maybeSingle(),
      ]);
      if (!active) return;
      const row = (preferences.data ?? null) as { equipment?: string[] | null; fitness_level?: string | null } | null;
      const level = (LEVELS as readonly string[]).includes(row?.fitness_level ?? "") ? (row!.fitness_level as Level) : null;
      setAccount({ status: "ready", userId: uid, profiles: lists.profiles, legacyWords: Array.isArray(row?.equipment) ? row.equipment : [], level, failed: Boolean(lists.error) });
    })();
    return () => { active = false; };
  }, [attempt]);

  const retry = useCallback(() => { setAccount({ status: "loading" }); setAttempt((value) => value + 1); }, []);

  const reloadProfiles = useCallback(async (saved?: { context: TrainingContext; keys: readonly string[] }) => {
    if (saved) setAccount((current) => (current.status === "ready" ? { ...current, profiles: withSavedList(current.profiles, saved.context, saved.keys) } : current));
    const supabase = createClient();
    const uid = userIdRef.current;
    if (!supabase || !uid) return;
    const lists = await loadEquipmentProfiles(supabase, uid);
    setAccount((current) => (current.status === "ready" ? { ...current, ...afterProfilesReload(current, lists) } : current));
  }, []);

  return { account, reloadProfiles, retry };
}

// ---------------------------------------------------------------- saved exercises

export type SavedState = {
  ready: boolean;
  store: SavedStore;
  ids: string[];
  /** A short message when the list could not be read (a change that fails is said in its own card: toggle). */
  problem: string;
  /** How many exercises saved on this device were just moved into the account. */
  moved: number;
};

/**
 * The member's saved exercises: in the account when exercise_favorites exists, else on this device. Waits for the
 * catalogue (`knownIds`, undefined while it loads; null when it could not load) so stale ids are never moved.
 */
export function useSavedExercises(userId: string, knownIds: ReadonlySet<string> | null | undefined) {
  const [saved, setSaved] = useState<SavedState>({ ready: false, store: "device", ids: [], problem: "", moved: 0 });
  const waiting = knownIds === undefined;
  const loadedFor = useRef("");

  useEffect(() => {
    if (!userId || waiting || loadedFor.current === userId) return;
    loadedFor.current = userId;
    let active = true;
    void loadSavedExercises(createClient(), userId, { knownIds }).then((result) => {
      if (!active) return;
      setSaved({
        ready: true, store: result.store, ids: result.ids, moved: result.moved,
        problem: result.error ? "Your saved exercises could not be loaded from your account. Showing the ones on this device." : "",
      });
    });
    return () => { active = false; loadedFor.current = ""; };
  }, [userId, waiting, knownIds]);

  const savedSet = useMemo(() => new Set(saved.ids), [saved.ids]);
  // Exercises whose save or remove is still on its way: another tap on one waits, so requests never cross.
  const pending = useRef(new Set<string>());

  // A change that fails is undone and its reason returned, for the card whose bookmark was pressed to show beside it
  // (D6; saved-toggle.ts): the page-wide `problem` is only about reading the list.
  const toggle = useCallback(async (exerciseId: string): Promise<SavedToggle> => {
    if (!userId || pending.current.has(exerciseId)) return { status: "ignored" };
    pending.current.add(exerciseId);
    const wasSaved = savedSet.has(exerciseId);
    setSaved((current) => ({ ...current, ids: withExerciseSaved(current.ids, exerciseId, !wasSaved) }));
    try {
      // A request that throws (rather than answering with an error) is a failure too: the bookmark never stays wrong.
      const { error } = await setExerciseSaved(createClient(), userId, saved.store, exerciseId, !wasSaved).catch((caught: unknown) => ({ error: caught ?? new Error("save failed") }));
      if (!error) return { status: "done" };
      // Only this exercise is undone; saves of other exercises made meanwhile stay as they are.
      setSaved((current) => ({ ...current, ids: withExerciseSaved(current.ids, exerciseId, wasSaved) }));
      return { status: "failed", message: savedToggleProblem(wasSaved) };
    } finally {
      pending.current.delete(exerciseId);
    }
  }, [saved.store, savedSet, userId]);

  return { saved, savedSet, toggle };
}
