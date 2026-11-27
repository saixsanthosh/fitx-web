/**
 * The shell's own fetch of the member's name, email and photo (useAccountSummary.ts), with a time limit (fix round 3f,
 * open-3e-account-summary-limit). The header and the sidebar show it until the shared user context
 * (UserContextProvider) has the profile, and when the context's load failed (accountSummary.ts preferSharedAccount).
 *
 * The fetch checks the session (Supabase Auth's getUser), reads the profile's name and photo, and signs a link to a
 * stored photo. None of that had a time limit, and the one request every reader shares was kept for 50 minutes (the
 * photo link's hour, less ten minutes) whatever became of it. So a request that never answered (a stalled connection, a
 * captive portal, a server that hangs) was handed to every header and sidebar mounted in those 50 minutes, and their
 * name and photo read "Your account" until the shared context answered.
 *
 * Now a request with no answer within ACCOUNT_SUMMARY_TIME_LIMIT_MS (20 s, like the shared context's refresh) is
 * dropped, so the next read asks again. Nothing is cancelled (Supabase Auth's request can't be): the readers that were
 * waiting still get its answer if it comes, unless a newer read's answer is already shown, and what they show meanwhile
 * stays. An answer within 20 s is kept and shared for 50 minutes, as before.
 *
 * No React here, so node:test covers it (tests/shell/account-summary-limit.test.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWithinLimit } from "@/lib/onboarding/time-limit";
import type { AccountSummary } from "./accountSummary";

/** How long a request waits for its answer before the next read asks again, in milliseconds. */
export const ACCOUNT_SUMMARY_TIME_LIMIT_MS = 20_000;

/** The signed photo link lasts an hour: an answer is kept this long, so the shell asks again a little before it ends. */
export const ACCOUNT_SUMMARY_MAX_AGE_MS = 50 * 60 * 1000;

/** The member's name, email and photo link, or null when no one is signed in here. */
export async function fetchAccountSummary(supabase: SupabaseClient): Promise<AccountSummary | null> {
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

/** Asks for the summary: `force` always makes a new request (a Profile save); otherwise a request is shared. */
export type SummaryRequest = (force?: boolean) => Promise<AccountSummary | null>;

/**
 * The one request every reader shares. A request that answered is shared until it is `maxAgeMs` old. One that has no
 * answer `ms` after it was made is dropped then, so the next read makes a new one; the readers already waiting on it
 * still get its answer if it comes. A fetch that breaks off gives null, as before.
 */
export function sharedSummaryRequest(
  load: () => PromiseLike<AccountSummary | null>,
  { ms = ACCOUNT_SUMMARY_TIME_LIMIT_MS, maxAgeMs = ACCOUNT_SUMMARY_MAX_AGE_MS }: { ms?: number; maxAgeMs?: number } = {},
): SummaryRequest {
  let request: Promise<AccountSummary | null> | null = null;
  let requestedAt = 0;
  return (force = false) => {
    if (force || !request || Date.now() - requestedAt > maxAgeMs) {
      const mine = new Promise<AccountSummary | null>((resolve) => resolve(load())).catch(() => null);
      request = mine;
      requestedAt = Date.now();
      // The limit only decides whether the next read may share this request: nothing is cancelled.
      void loadWithinLimit(() => mine, ms).then((ended) => {
        if (!ended && request === mine) request = null;
      });
    }
    return request;
  };
}

/**
 * One reader of the shared request (each mounted header and sidebar): `read(force)` asks, and `show` gets that read's
 * answer when it comes, however late, unless the answer to a newer read is already shown, so an older request never
 * puts back older details. After `stop()` (the reader went) nothing more is shown.
 */
export function summaryReader(request: SummaryRequest, show: (summary: AccountSummary | null) => void) {
  let live = true;
  let reads = 0;
  let shown = 0;
  return {
    read(force = false) {
      const mine = ++reads;
      void request(force).then((summary) => {
        if (!live || mine < shown) return;
        shown = mine;
        show(summary);
      });
    },
    stop() {
      live = false;
    },
  };
}
