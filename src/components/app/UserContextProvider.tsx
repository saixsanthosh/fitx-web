"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { loadUserContext, syncProfileWeight, USER_CONTEXT_EVENT, type LoadPart, type UserContextData } from "@/lib/domain/user-context";

/**
 * One shared copy of the signed-in user's profile, preferences, latest weigh-in and daily targets for
 * the signed-in app (mounted in the dashboard layout). Screens read it with useUserContext(); after a
 * save they call notifyUserContextChanged() (from @/lib/domain/user-context) and every reader updates:
 * the header's name and photo, Home's and Nutrition's targets, the coach's context.
 */

export type UserContextStatus = "loading" | "ready" | "signed_out" | "unavailable" | "error";

export type UserContextValue = {
  status: UserContextStatus;
  data: UserContextData | null;
  /** A signed link to the private profile photo (renewed before it expires), or the provider's photo URL. */
  avatarUrl: string | null;
  /** Which read failed when status is "error". */
  failedPart: LoadPart | null;
  refresh: () => Promise<void>;
};

const AVATAR_LINK_SECONDS = 60 * 60;
/** Renew the signed photo link ten minutes before it expires. */
const AVATAR_RENEW_MS = (AVATAR_LINK_SECONDS - 10 * 60) * 1000;
const MEDIA_BUCKET = "fitx-user-media";

const Context = createContext<UserContextValue | null>(null);

export function UserContextProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UserContextStatus>("loading");
  const [data, setData] = useState<UserContextData | null>(null);
  const [failedPart, setFailedPart] = useState<LoadPart | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const request = useRef(0);
  const healed = useRef<string | null>(null);
  const loadedUser = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) {
      setStatus("unavailable");
      return;
    }
    const ticket = ++request.current;
    const { data: auth } = await supabase.auth.getUser();
    if (ticket !== request.current) return;
    if (!auth.user) {
      setData(null);
      setStatus("signed_out");
      return;
    }
    const result = await loadUserContext(supabase, { id: auth.user.id, email: auth.user.email ?? null });
    if (ticket !== request.current) return;
    if (result.error) {
      setFailedPart(result.error.part);
      setStatus("error");
      return;
    }
    const loaded = result.data;
    loadedUser.current = loaded.userId;
    setData(loaded);
    setFailedPart(null);
    setStatus("ready");
    // Weigh-ins logged before Progress kept profiles.weight in step: bring it up to date once, so the
    // screens that still read profiles.weight use the same weight as everything else.
    const latest = loaded.latestWeighIn?.weight;
    if (latest != null && loaded.profile && loaded.profile.weight !== latest && healed.current !== loaded.userId) {
      healed.current = loaded.userId;
      void syncProfileWeight(supabase, loaded.userId, latest);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const onChange = () => void refresh();
    window.addEventListener(USER_CONTEXT_EVENT, onChange);
    const supabase = createClient();
    const subscription = supabase?.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === "SIGNED_OUT") {
        request.current += 1;
        loadedUser.current = null;
        setData(null);
        setAvatarUrl(null);
        setStatus("signed_out");
      } else if (event === "USER_UPDATED" || (event === "SIGNED_IN" && session?.user && session.user.id !== loadedUser.current)) {
        // SIGNED_IN also fires when a tab regains focus; only a different account needs a reload.
        void refresh();
      }
    }).data.subscription;
    return () => {
      window.removeEventListener(USER_CONTEXT_EVENT, onChange);
      subscription?.unsubscribe();
    };
  }, [refresh]);

  const avatarPath = data?.profile?.avatar ?? null;
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sign = async () => {
      if (!avatarPath) return setAvatarUrl(null);
      if (/^https:\/\//.test(avatarPath)) return setAvatarUrl(avatarPath);
      const supabase = createClient();
      if (!supabase) return;
      const { data: signed } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(avatarPath, AVATAR_LINK_SECONDS);
      if (!live) return;
      setAvatarUrl(signed?.signedUrl ?? null);
      timer = setTimeout(() => void sign(), AVATAR_RENEW_MS);
    };
    void Promise.resolve().then(sign);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [avatarPath]);

  const value = useMemo<UserContextValue>(() => ({ status, data, avatarUrl, failedPart, refresh }), [status, data, avatarUrl, failedPart, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The shared user context. Throws outside UserContextProvider, so a missing provider is caught early. */
export function useUserContext(): UserContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useUserContext needs <UserContextProvider> (mounted in the dashboard layout).");
  return value;
}

/** The shared user context, or null where no provider is mounted (onboarding, pages that load their own data). */
export function useOptionalUserContext(): UserContextValue | null {
  return useContext(Context);
}
