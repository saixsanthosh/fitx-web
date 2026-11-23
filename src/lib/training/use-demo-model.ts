"use client";

/**
 * The member's demonstration model and the demonstration index, shared by every card and player on a page
 * (wave 2, D6). Both are read **once per page load**: one fetch of /media/demos/index.json and one small setup read
 * (the member's choice and their profile's gender), however many cards ask. A list of 50 cards makes those two
 * requests and no more (tests/training/demo-model.test.ts).
 *
 *   const index = useDemoIndex();          // Map(exercise id -> ["male", "female"]) once loaded, else null
 *   const model = useDemoModel();          // "male" | "female" | null (null: no choice and no male/female gender)
 *   const model = useDemoModel(fromPage);  // a page that already knows it passes it, and nothing is read
 *   await chooseDemoModel("female");       // the "Demonstration model" choice: saves it, every card follows
 *
 * Without an index file, or with an empty one, nothing changes anywhere: every surface shows today's photos.
 */
import { useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEMO_INDEX_PATH, EMPTY_DEMO_INDEX, parseDemoIndex, type DemoIndex, type DemoModelKey } from "./media";
import { loadDemoModel, saveDemoModel } from "./setup";

export type DemoStoreDeps = {
  /** The index file's JSON, or null when there is none (404) or it cannot be read. */
  fetchIndex: () => Promise<unknown>;
  /** The member's model (choice, else gender), or null; null too when signed out or unreadable. */
  loadModel: () => Promise<DemoModelKey | null>;
  saveModel: (model: DemoModelKey) => Promise<{ error: unknown; stored: boolean }>;
};

export type DemoStore = ReturnType<typeof createDemoStore>;

/** The page-wide state behind the hooks; exported so tests can count its requests. */
export function createDemoStore(deps: DemoStoreDeps) {
  let indexPromise: Promise<DemoIndex> | null = null;
  let index: DemoIndex | null = null;
  let modelPromise: Promise<DemoModelKey | null> | null = null;
  let loadedModel: DemoModelKey | null | undefined;
  /** Chosen on this page (the radio group): wins over everything else until the page is left. */
  let chosen: DemoModelKey | undefined;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Starts the one index fetch of this page (later calls share it). Never rejects. */
    loadIndex(): Promise<DemoIndex> {
      indexPromise ??= Promise.resolve()
        .then(() => deps.fetchIndex())
        .then((json) => parseDemoIndex(json) ?? EMPTY_DEMO_INDEX, () => EMPTY_DEMO_INDEX)
        .then((value) => { index = value; emit(); return value; });
      return indexPromise;
    },
    /** Starts the one setup read of this page (later calls share it). Never rejects. */
    loadModel(): Promise<DemoModelKey | null> {
      modelPromise ??= Promise.resolve()
        .then(() => deps.loadModel())
        .then((value) => value ?? null, () => null)
        .then((value) => { loadedModel = value; emit(); return value; });
      return modelPromise;
    },
    index: () => index,
    /** The model to show: chosen here, else the page's own value when it passes one, else the one read. */
    model(preferred?: DemoModelKey | null): DemoModelKey | null {
      if (chosen) return chosen;
      if (preferred !== undefined) return preferred;
      return loadedModel ?? null;
    },
    async choose(model: DemoModelKey): Promise<{ error: unknown; stored: boolean }> {
      chosen = model;
      emit();
      try {
        return await deps.saveModel(model);
      } catch (error) {
        return { error, stored: false };
      }
    },
  };
}

async function signedInUserId(): Promise<{ db: NonNullable<ReturnType<typeof createClient>>; userId: string } | null> {
  const db = createClient();
  if (!db) return null;
  // The session already in this browser: no request. The reads that follow are protected by row-level security.
  const { data } = await db.auth.getSession();
  const userId = data.session?.user?.id;
  return userId ? { db, userId } : null;
}

const pageStore = createDemoStore({
  async fetchIndex() {
    const response = await fetch(DEMO_INDEX_PATH, { credentials: "same-origin" });
    return response.ok ? response.json() : null;
  },
  async loadModel() {
    const signedIn = await signedInUserId();
    return signedIn ? loadDemoModel(signedIn.db, signedIn.userId) : null;
  },
  async saveModel(model) {
    const signedIn = await signedInUserId();
    return signedIn ? saveDemoModel(signedIn.db, signedIn.userId, model) : { error: new Error("Not signed in"), stored: false };
  },
});

/** The parsed demonstration index (frames, captions and credit), or null while it loads. */
export function useDemoIndexData(): DemoIndex | null {
  useEffect(() => { void pageStore.loadIndex(); }, []);
  return useSyncExternalStore(pageStore.subscribe, pageStore.index, () => null);
}

/** Which models each exercise's demonstrations have, or null while the index loads. Empty without demonstrations. */
export function useDemoIndex(): ReadonlyMap<string, readonly DemoModelKey[]> | null {
  return useDemoIndexData()?.models ?? null;
}

/**
 * The member's demonstration model. A page that already knows it passes `preferred` (then nothing is read);
 * otherwise the page's one setup read decides. A choice made on this page always wins.
 */
export function useDemoModel(preferred?: DemoModelKey | null): DemoModelKey | null {
  const needsRead = preferred === undefined;
  useEffect(() => { if (needsRead) void pageStore.loadModel(); }, [needsRead]);
  return useSyncExternalStore(pageStore.subscribe, () => pageStore.model(preferred), () => preferred ?? null);
}

/** Saves the member's choice and switches every demonstration and card on the page to it at once. */
export function chooseDemoModel(model: DemoModelKey): Promise<{ error: unknown; stored: boolean }> {
  return pageStore.choose(model);
}

/** The Workouts setup's line under "Demonstrations" (WorkoutSetupFlow, wired in by the integrator). */
export function DEMO_SETUP_NOTE(available: boolean): string {
  return available
    ? "Used for FITX's AI demonstrations, made from real photos of each movement. Others show the original photos."
    : "Used wherever a demonstration has both. Most show the original photos for now.";
}
