import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { loadSavedExercises, setExerciseSaved, type SavedStore } from "@/lib/domain/exercise-preferences";
import { createClient } from "@/lib/supabase/client";
import type { CatalogExercise } from "@/lib/training/catalog";
import { loadEquipmentProfiles, type EquipmentProfiles } from "@/lib/training/data";
import { LEVELS, type Level } from "@/lib/training/taxonomy";
import { loadLightCatalogue } from "./catalogue";

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

/** The signed-in member, their saved Home and Gym lists and their level; `reloadProfiles` after saving a list. */
export function useLibraryAccount(): { account: LibraryAccount; reloadProfiles: () => Promise<void> } {
  const [account, setAccount] = useState<LibraryAccount>({ status: "loading" });
  const userIdRef = useRef("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) { if (active) setAccount({ status: "unavailable" }); return; }
      const { data } = await supabase.auth.getUser();
      if (!active) return;
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
  }, []);

  const reloadProfiles = useCallback(async () => {
    const supabase = createClient();
    const uid = userIdRef.current;
    if (!supabase || !uid) return;
    const lists = await loadEquipmentProfiles(supabase, uid);
    setAccount((current) => (current.status === "ready" ? { ...current, profiles: lists.profiles, failed: Boolean(lists.error) } : current));
  }, []);

  return { account, reloadProfiles };
}

// ---------------------------------------------------------------- saved exercises

export type SavedState = {
  ready: boolean;
  store: SavedStore;
  ids: string[];
  /** A short message when the list could not be read or a change could not be saved. */
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

  const toggle = useCallback(async (exerciseId: string) => {
    if (!userId) return;
    const wasSaved = savedSet.has(exerciseId);
    const before = saved.ids;
    setSaved((current) => ({ ...current, problem: "", ids: wasSaved ? current.ids.filter((id) => id !== exerciseId) : [exerciseId, ...current.ids] }));
    const { error } = await setExerciseSaved(createClient(), userId, saved.store, exerciseId, !wasSaved);
    if (error) setSaved((current) => ({ ...current, ids: before, problem: wasSaved ? "That exercise could not be removed from your saved list. Try again." : "That exercise could not be saved. Try again." }));
  }, [saved.ids, saved.store, savedSet, userId]);

  return { saved, savedSet, toggle };
}
