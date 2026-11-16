"use client";

import { useEffect, useMemo, useState } from "react";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { createClient } from "@/lib/supabase/client";
import { preferSharedAccount, type AccountSummary } from "./accountSummary";

export type { AccountSummary } from "./accountSummary";

/** Fired by the Profile page after a save, so the shell shows the new name and photo at once. */
export const PROFILE_UPDATED_EVENT = "fitx:profile-updated";

/** The signed avatar link lasts an hour; refresh a little before it expires. */
const MAX_AGE_MS = 50 * 60 * 1000;
let request: Promise<AccountSummary | null> | null = null;
let requestedAt = 0;

async function fetchSummary(): Promise<AccountSummary | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("name, avatar").eq("id", user.id).maybeSingle();
  let avatarUrl: string | null = profile?.avatar || null;
  if (avatarUrl && !avatarUrl.startsWith("http")) {
    const signed = await supabase.storage.from("fitx-user-media").createSignedUrl(avatarUrl, 3600);
    avatarUrl = signed.data?.signedUrl || null;
  }
  return {
    name: profile?.name || user.user_metadata?.name || user.email?.split("@")[0] || "",
    email: user.email ?? null,
    avatarUrl,
  };
}

function summary(force = false) {
  if (force || !request || Date.now() - requestedAt > MAX_AGE_MS) {
    requestedAt = Date.now();
    request = fetchSummary().catch(() => null);
  }
  return request;
}

/**
 * Name, email and photo for the shell. Inside the dashboard layout the shared user context supplies
 * the name and the photo link (so a Profile save shows at once and the link never expires); one shared
 * request fills in elsewhere and until the context has loaded.
 */
export function useAccountSummary() {
  const shared = useOptionalUserContext();
  const [value, setValue] = useState<AccountSummary | null>(null);
  useEffect(() => {
    let live = true;
    const load = (force = false) => { void summary(force).then((result) => { if (live) setValue(result); }); };
    load();
    const refresh = () => load(true);
    window.addEventListener(PROFILE_UPDATED_EVENT, refresh);
    const timer = window.setInterval(() => load(), MAX_AGE_MS);
    return () => {
      live = false;
      window.removeEventListener(PROFILE_UPDATED_EVENT, refresh);
      window.clearInterval(timer);
    };
  }, []);
  return useMemo(() => preferSharedAccount(value, shared), [value, shared]);
}
