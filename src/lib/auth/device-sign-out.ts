import type { LocksLike } from "@/lib/activity/device-recordings";
import { recordingStore, type RecordingStore } from "@/lib/activity/local-store";
import type { SupabaseLike } from "@/lib/activity/repository";
import type { DeviceActivityAtSignOut, prepareDeviceActivityForSignOut } from "@/lib/activity/sign-out";
import { SESSION_COOKIE_RE } from "./cookies";

/**
 * Signing this browser out, with the account's activity recordings on this device (GPS tracks): they are
 * uploaded where possible first, FITX asks before deleting any that aren't saved to the account yet, and
 * they are removed from the device once the session has ended. "Log out" (LogoutButton) and the "Sign in
 * again" step of account deletion (DeleteAccount) both sign out through here.
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
    getSession(): Promise<{ data: { session: { user: { id: string } } | null } }>;
    signOut(options: { scope: "local" | "global" }): Promise<{ error: unknown }>;
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
 * "signed_out": the session on this browser has ended and this account's recordings are off the device.
 * "cancelled": the member chose to keep recordings that aren't saved to their account yet; still signed in.
 * "failed": signing out of every device didn't work; still signed in here.
 */
export type SignOutOutcome = "signed_out" | "cancelled" | "failed";

/**
 * Signs out this browser ("local") or every device ("global"). `ask` puts the "not saved yet" question to the
 * member (window.confirm in the app). A local sign-out always ends the session here, even when Supabase
 * can't be reached: its session cookies are removed in the browser.
 */
export async function signOutWithDeviceActivity(
  supabase: SignOutClient,
  { scope = "local", ask, ...options }: DeviceActivityOptions & { scope?: "local" | "global"; ask: (question: string) => boolean },
): Promise<SignOutOutcome> {
  const activity = await deviceActivityAtSignOut(supabase, options);
  if (activity && activity.notUploaded > 0 && !ask(notUploadedQuestion(activity.notUploaded))) return "cancelled";
  try {
    const { error } = await supabase.auth.signOut({ scope });
    if (error) throw error;
  } catch {
    if (scope === "global") return "failed";
    clearSessionCookies();
  }
  if (activity) await within(ACTIVITY_CLEAR_LIMIT_MS, activity.clear());
  return "signed_out";
}

function clearSessionCookies() {
  if (typeof document === "undefined") return;
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name && SESSION_COOKIE_RE.test(name)) document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}
