"use client";

import { useEffect, useMemo, useState } from "react";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { createClient } from "@/lib/supabase/client";
import { ACCOUNT_SUMMARY_MAX_AGE_MS, fetchAccountSummary, sharedSummaryRequest, summaryReader } from "./account-summary-request";
import { preferSharedAccount, type AccountSummary } from "./accountSummary";

export type { AccountSummary } from "./accountSummary";

/** Fired by the Profile page after a save, so the shell shows the new name and photo at once. */
export const PROFILE_UPDATED_EVENT = "fitx:profile-updated";

/**
 * The one request the header and the sidebar share: kept 50 minutes once it answers, and dropped when it has no answer
 * within 20 s, so the next read asks again (account-summary-request.ts).
 */
const summary = sharedSummaryRequest(() => {
  const supabase = createClient();
  return supabase ? fetchAccountSummary(supabase) : Promise.resolve(null);
});

/**
 * Name, email and photo for the shell. Inside the dashboard layout the shared user context supplies
 * the name and the photo link (so a Profile save shows at once and the link never expires); one shared
 * request fills in elsewhere and until the context has loaded.
 */
export function useAccountSummary() {
  const shared = useOptionalUserContext();
  const [value, setValue] = useState<AccountSummary | null>(null);
  useEffect(() => {
    // Each read's answer shows when it comes, even after the 20 s limit, unless a newer read's answer already shows.
    const reader = summaryReader(summary, setValue);
    reader.read();
    const refresh = () => reader.read(true);
    window.addEventListener(PROFILE_UPDATED_EVENT, refresh);
    const timer = window.setInterval(() => reader.read(), ACCOUNT_SUMMARY_MAX_AGE_MS);
    return () => {
      reader.stop();
      window.removeEventListener(PROFILE_UPDATED_EVENT, refresh);
      window.clearInterval(timer);
    };
  }, []);
  return useMemo(() => preferSharedAccount(value, shared), [value, shared]);
}
