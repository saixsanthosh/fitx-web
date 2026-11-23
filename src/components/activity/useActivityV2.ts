"use client";

import { useEffect, useState } from "react";
import { activityV2Ready, listBestEfforts, type StoredEfforts } from "@/lib/activity/repository";
import { createClient } from "@/lib/supabase/client";

/**
 * Whether this site's database has migration 20261123100050 (the newer sports and stored best efforts): null while
 * checking. Screens offer the newer sports only once it says true, so nothing is offered that cannot be saved.
 */
export function useActivityV2(userId: string | null): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    void activityV2Ready(supabase, userId).then((value) => {
      if (active) setReady(value);
    });
    return () => {
      active = false;
    };
  }, [userId]);
  return userId ? ready : null;
}

export type EffortsState = { status: "loading" } | { status: "ready"; rows: StoredEfforts[] } | { status: "unavailable" } | { status: "error" };

/** Every activity's stored best efforts, for rankings. `key` reloads (after an activity page fills one in). */
export function useStoredEfforts(userId: string | null, key = 0): EffortsState {
  const [state, setState] = useState<EffortsState>({ status: "loading" });
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    void listBestEfforts(supabase, userId).then((result) => {
      if (!active) return;
      setState(result.status === "ok" ? { status: "ready", rows: result.data } : result.status === "unavailable" ? { status: "unavailable" } : { status: "error" });
    });
    return () => {
      active = false;
    };
  }, [userId, key]);
  return state;
}
