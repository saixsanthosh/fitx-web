import type { LocksLike } from "@/lib/activity/device-recordings";
import { recordingStore, type RecordingStore } from "@/lib/activity/local-store";
import type { SupabaseLike } from "@/lib/activity/repository";
import type { DeviceActivityAtSignOut, prepareDeviceActivityForSignOut } from "@/lib/activity/sign-out";
import { SESSION_COOKIE_RE } from "./cookies";

/**
 * Signing this browser out, with the account's activity recordings on this device (GPS tracks): they are
 * uploaded where possible first, FITX asks before deleting any that aren't saved to the account yet, and
 * they are removed from the device once the session has ended. "Log out" and "Sign out everywhere"
 * (LogoutButton) and the "Sign in again" step of account deletion (DeleteAccount) all sign out through here.
 *
 * The upload code brings the GPS engine with it, so it loads only when the device holds recordings for
 * the account. Each slow step has its own time limit and falls back to what is already known, so a slow
 * network never traps anyone signed in, and never skips the question or the clean-up either.
 */

/** Reading the session and listing this device's recordings (IndexedDB). A browser that never answers here holds none FITX can find. */
export const ACTIVITY_LIST_LIMIT_MS = 5000;
/**
 * Loading the upload code and uploading (sign-out.ts gives the uploads 8 s of this). After it, every
 * recording still on the device is asked about, as if nothing had uploaded.
 */
export const ACTIVITY_PREPARE_LIMIT_MS = 10000;
/** Removing the recordings once signed out. */
export const ACTIVITY_CLEAR_LIMIT_MS = 3000;
/** Counting what is left after the uploads ran out of time. */
const ACTIVITY_RECOUNT_LIMIT_MS = 1000;

/** The promise's value, or null when it fails or takes longer than `ms`. */
export async function within<T>(ms: number, promise: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function notUploadedQuestion(count: number) {
  return count === 1
    ? "1 activity on this device isn’t saved to your account yet. Sign out and delete it from this device?"
    : `${count} activities on this device aren’t saved to your account yet. Sign out and delete them from this device?`;
}

/** The parts of the Supabase client signing out uses. */
export type SignOutClient = SupabaseLike & {
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string }; access_token?: string } | null }; error?: unknown }>;
    signOut(options: { scope: "local" | "global" }): Promise<{ error: unknown }>;
    /**
     * Signing out of every device asks Auth about this device's session first (getUser), then sends the logout itself
     * through admin.signOut, which returns Auth's refusal. signOut({ scope: "global" }) can't be trusted for that: it
     * answers "no error" when this browser holds no session (it sends nothing) and when Auth refuses the logout
     * (supabase-js ignores a 401, 403 or 404 there). A client without these two (a stand-in that only signs this device
     * out) can't sign out everywhere: "failed", never a claim.
     */
    getUser?(): Promise<{ data: { user: unknown } | null; error: unknown }>;
    admin?: { signOut(jwt: string, scope: "global"): Promise<{ error: unknown }> };
  };
};

type Prepare = typeof prepareDeviceActivityForSignOut;

export type DeviceActivityOptions = {
  /** The device's recordings; IndexedDB in the app, a memory store in tests. */
  openStore?: () => Promise<RecordingStore>;
  /** The upload step; loaded with the GPS engine on demand in the app, passed in by tests. */
  loadPrepare?: () => Promise<Prepare>;
  locks?: LocksLike | null;
  listLimitMs?: number;
  prepareLimitMs?: number;
};

const loadPrepareChunk = async (): Promise<Prepare> => (await import("@/lib/activity/sign-out")).prepareDeviceActivityForSignOut;

function browserLocks(): LocksLike | null {
  return typeof navigator === "undefined" ? null : ((navigator as Navigator & { locks?: LocksLike }).locks ?? null);
}

/**
 * This account's activity recordings on this device, uploaded where possible, or null when the browser keeps
 * none for it (no session, no IndexedDB in private mode or with storage blocked, or IndexedDB not answering).
 */
export async function deviceActivityAtSignOut(supabase: SignOutClient, options: DeviceActivityOptions = {}): Promise<DeviceActivityAtSignOut | null> {
  const listed = await within(options.listLimitMs ?? ACTIVITY_LIST_LIMIT_MS, (async () => {
    const userId = (await supabase.auth.getSession()).data.session?.user.id;
    if (!userId) return null;
    const store = await (options.openStore ?? recordingStore)();
    return { userId, store, kept: (await store.listRecordings(userId)).length };
  })());
  if (!listed) return null;
  const { userId, store, kept } = listed;
  // The account's recordings, and log entries a crash left without one (what clearDeviceActivityData does).
  const clear = () => store.deleteAll(userId).then(() => store.deleteOrphanEntries()).catch(() => undefined);
  // Nothing kept for this account, the usual case: no upload code to load.
  if (!kept) return { notUploaded: 0, clear };
  const locks = options.locks !== undefined ? options.locks : browserLocks();
  const prepared = await within(options.prepareLimitMs ?? ACTIVITY_PREPARE_LIMIT_MS, (async () => {
    const prepare = await (options.loadPrepare ?? loadPrepareChunk)();
    return prepare(store, supabase, userId, { locks });
  })());
  if (prepared) return prepared;
  // The upload code didn't load (offline, or too slowly) or the uploads ran out of time: whatever is still on
  // the device is asked about, and removed only once the member agrees.
  const left = await within(ACTIVITY_RECOUNT_LIMIT_MS, store.listRecordings(userId).then((rows) => rows.length));
  return { notUploaded: left ?? kept, clear };
}

/**
 * "signed_out": the session on this browser has ended and this account's recordings are off the device. For
 *   "global", Auth also confirmed that it ended every other session of the account.
 * "ended" ("global" only): this device's session had already ended (or the browser held none), so there was no session
 *   to end the others with. This device is signed out now and its recordings are off it; other devices may still be
 *   signed in.
 * "cancelled": the member chose to keep recordings that aren't saved to their account yet; still signed in.
 * "failed": signing out of every device didn't work, or Auth couldn't say whether it did; still signed in here.
 */
export type SignOutOutcome = "signed_out" | "ended" | "cancelled" | "failed";

/** Auth error codes that say this device's session is over, rather than that Auth couldn't be asked. */
const ENDED_CODES: ReadonlySet<string> = new Set([
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "user_not_found",
  "user_banned",
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
]);

/**
 * What a refusal from Auth says about this device's session: "ended" (no session in this browser, or Auth says it is
 * over: signed out everywhere elsewhere, a password changed in another session, an expired or revoked session, a
 * deleted account), or "unknown" (offline, a timeout, a server error, a rate limit: nothing is known). The same rules as
 * Settings' own check of the session (bug 41, the home stream's src/components/account/session-state.ts).
 */
export function refusalMeans(error: unknown): "ended" | "unknown" {
  if (typeof error !== "object" || error === null) return "unknown";
  const { name, status, code } = error as { name?: unknown; status?: unknown; code?: unknown };
  // supabase-js: no session in this browser, or Auth's session_not_found.
  if (name === "AuthSessionMissingError") return "ended";
  if (name === "AuthRetryableFetchError" || name === "AuthUnknownError") return "unknown";
  if (typeof code === "string" && ENDED_CODES.has(code)) return "ended";
  return status === 401 || status === 403 ? "ended" : "unknown";
}

/**
 * "everywhere": Auth ended every session of the account, this device's too. "ended": this device's session had already
 * ended (or the browser held none). "unknown": Auth couldn't be asked, or its answer didn't come.
 */
export type EveryDevice = "everywhere" | "ended" | "unknown";

/**
 * Signs the account out on every device, and says only what Auth said (review security:R3-SEC-2). First Auth's word on
 * this device's session (supabase-js renews the token first when it is about to expire): a session Auth already ended
 * can't end the others. Then the logout itself with this session's token, whose refusal (the session ended in
 * between) is "ended" too, never success. Leaves this device's own session for the caller to remove.
 */
export async function endEverySession(auth: SignOutClient["auth"]): Promise<EveryDevice> {
  const admin = auth.admin;
  if (!auth.getUser || !admin) return "unknown";
  try {
    const user = await auth.getUser();
    if (user?.error) return refusalMeans(user.error);
    if (!user?.data?.user) return "ended";
    const { data, error } = await auth.getSession();
    if (error) return refusalMeans(error);
    const token = data.session?.access_token;
    if (!token) return "ended";
    const { error: refused } = await admin.signOut(token, "global");
    return refused ? refusalMeans(refused) : "everywhere";
  } catch {
    // supabase-js returns Auth's refusals; a throw is something unexpected, which proves nothing.
    return "unknown";
  }
}

/**
 * Signs out this browser ("local") or every device ("global"). `ask` puts the "not saved yet" question to the
 * member (window.confirm in the app). Once it goes ahead, this device's session always ends here, even when
 * Supabase can't be reached: its session cookies are removed in the browser. "global" goes ahead only when Auth
 * has answered (endEverySession): its "unknown" is "failed", with everything left as it was.
 */
export async function signOutWithDeviceActivity(
  supabase: SignOutClient,
  { scope = "local", ask, ...options }: DeviceActivityOptions & { scope?: "local" | "global"; ask: (question: string) => boolean },
): Promise<SignOutOutcome> {
  const activity = await deviceActivityAtSignOut(supabase, options);
  if (activity && activity.notUploaded > 0 && !ask(notUploadedQuestion(activity.notUploaded))) return "cancelled";
  const everyDevice = scope === "global" ? await endEverySession(supabase.auth) : null;
  if (everyDevice === "unknown") return "failed";
  // This device's session: Log out's, one Auth has just ended with all the others, or one that was already over.
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
  } catch {
    clearSessionCookies();
  }
  if (activity) await within(ACTIVITY_CLEAR_LIMIT_MS, activity.clear());
  return everyDevice === "ended" ? "ended" : "signed_out";
}

function clearSessionCookies() {
  if (typeof document === "undefined") return;
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name && SESSION_COOKIE_RE.test(name)) document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}
