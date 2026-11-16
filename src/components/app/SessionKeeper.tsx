"use client";

import { useEffect } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { stampedRecently, stampSessionCookies } from "@/lib/auth/session-stamp";
import { createClient } from "@/lib/supabase/client";

/**
 * The browser refreshes the session about once an hour and writes the new cookies from script. After
 * each refresh, and on the first signed-in page of a visit, this has the server re-send them, so
 * staying signed in doesn't depend on the browser's limits for script-written cookies.
 */
export function SessionKeeper() {
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let timer: number | undefined;
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void supabase.auth.getSession().then(({ data: current }: { data: { session: Session | null } }) => {
          if (current.session) void stampSessionCookies();
        });
      }, 250);
    };
    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === "SIGNED_OUT" || !session) {
        window.clearTimeout(timer);
        return;
      }
      if (event === "TOKEN_REFRESHED") soon();
      else if ((event === "INITIAL_SESSION" || event === "SIGNED_IN") && !stampedRecently()) soon();
    });
    return () => {
      window.clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);
  return null;
}
