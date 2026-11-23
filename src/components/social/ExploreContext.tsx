"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSession, sessionProblem, type Session } from "@/components/tasks/session";
import { socialApi, toSocialError, type SocialMe } from "@/lib/social";

export type ExploreStatus = "loading" | "signed_out" | "not_configured" | "unavailable" | "error" | "setup" | "ready";

type ExploreValue = {
  status: ExploreStatus;
  session: Session | null;
  me: SocialMe | null;
  /** Reads the member's Explore state again (after a profile save, or to update the unread badge). */
  refresh: () => Promise<void>;
  setMe: (next: SocialMe) => void;
};

const Context = createContext<ExploreValue | null>(null);

/** Explore's shared state: the session, the member's Explore profile and their unread counts. */
export function ExploreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ExploreStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMeState] = useState<SocialMe | null>(null);
  const ticket = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++ticket.current;
    let current: Session;
    try {
      current = await getSession();
    } catch (error) {
      if (mine !== ticket.current) return;
      const kind = sessionProblem(error);
      setStatus(kind === "signed-out" ? "signed_out" : kind === "not-configured" ? "not_configured" : "error");
      return;
    }
    try {
      const next = await socialApi.me(current.db);
      if (mine !== ticket.current) return;
      setSession(current);
      setMeState(next);
      setStatus(next.profile ? "ready" : "setup");
    } catch (error) {
      if (mine !== ticket.current) return;
      setSession(current);
      setStatus(toSocialError(error).key === "unavailable" ? "unavailable" : "error");
    }
  }, []);

  const setMe = useCallback((next: SocialMe) => {
    setMeState(next);
    setStatus(next.profile ? "ready" : "setup");
  }, []);

  useEffect(() => {
    // The first read happens once the page is in the browser (the session lives in its cookies).
    const start = window.setTimeout(() => void refresh(), 0);
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearTimeout(start);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const value = useMemo(() => ({ status, session, me, refresh, setMe }), [status, session, me, refresh, setMe]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useExplore(): ExploreValue {
  const value = useContext(Context);
  if (!value) throw new Error("useExplore needs ExploreProvider");
  return value;
}

/** For screens shown only once the member has a profile. */
export function useReadyExplore() {
  const { session, me, refresh, setMe } = useExplore();
  if (!session || !me?.profile) throw new Error("Explore is not ready");
  return { db: session.db, userId: session.userId, me, profile: me.profile, refresh, setMe };
}
