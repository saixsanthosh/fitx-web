"use client";

import { useEffect, useState } from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { latestWeight } from "@/lib/activity/repository";
import { createClient } from "@/lib/supabase/client";

export type ActivityAccount =
  | { status: "loading" }
  | { status: "unconfigured" }
  | { status: "signed-out" }
  | { status: "error" }
  | { status: "ready"; userId: string; weightKg: number | null };

/** The signed-in account and its latest body weight (for estimated calories). */
export function useActivityAccount(): ActivityAccount {
  const [account, setAccount] = useState<ActivityAccount>({ status: "loading" });
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void (async () => {
      if (!supabase) {
        if (active) setAccount({ status: "unconfigured" });
        return;
      }
      try {
        const { data, error } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) {
          // A network failure is not the same as being signed out.
          if (active) setAccount({ status: error && isAuthRetryableFetchError(error) ? "error" : "signed-out" });
          return;
        }
        const weightKg = await latestWeight(supabase, user.id);
        if (active) setAccount({ status: "ready", userId: user.id, weightKg });
      } catch {
        if (active) setAccount({ status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  return account;
}
