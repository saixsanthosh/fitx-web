import { clearDeviceActivityData, type LocksLike } from "./device-recordings";
import type { RecordingStore } from "./local-store";
import type { SupabaseLike } from "./repository";
import { prepareActivitySignOut } from "./sync";

/** How long signing out waits for this device's recordings to upload before asking what to do with them. */
export const SIGN_OUT_UPLOAD_TIMEOUT_MS = 8000;
/** How long removing them may take before signing out goes ahead anyway. */
export const SIGN_OUT_CLEAR_TIMEOUT_MS = 3000;

export type DeviceActivityAtSignOut = {
  /** The account's recordings still on this device and not on the server: unfinished, refused or not uploaded in time. */
  notUploaded: number;
  /** Removes the account's recordings (and orphaned log entries) from this device. Never throws. */
  clear(): Promise<void>;
};

/**
 * Signing out must not leave an account's GPS recordings on a shared device. Before the session ends,
 * this uploads the account's finished recordings that this device still holds (for at most `timeoutMs`,
 * so a slow network never traps anyone signed in) and counts what would be lost if the device were
 * cleared now, so the app can ask first. Call `clear()` once signing out has worked.
 * This module brings the GPS engine with it (to tidy unfinished recordings), so LogoutButton loads it
 * only when someone signs out.
 */
export async function prepareDeviceActivityForSignOut(
  store: RecordingStore,
  client: SupabaseLike,
  userId: string,
  { locks = null, timeoutMs = SIGN_OUT_UPLOAD_TIMEOUT_MS, clearTimeoutMs = SIGN_OUT_CLEAR_TIMEOUT_MS }: { locks?: LocksLike | null; timeoutMs?: number; clearTimeoutMs?: number } = {},
): Promise<DeviceActivityAtSignOut> {
  const uploaded = await withTimeout(prepareActivitySignOut(store, client, userId, locks).then((result) => result.notUploaded), timeoutMs);
  // Slow or failed uploads: count what is still here; recordings that can't even be listed can't be counted.
  const notUploaded = uploaded ?? (await withTimeout(store.listRecordings(userId).then((rows) => rows.length), timeoutMs)) ?? 0;
  return {
    notUploaded,
    clear: async () => {
      await withTimeout(clearDeviceActivityData(store, userId), clearTimeoutMs);
    },
  };
}

/** The promise's value, or null when it fails or takes longer than `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
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
