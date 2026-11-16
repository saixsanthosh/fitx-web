import { ActivityEngine } from "./engine";
import { defaultTitle } from "./format";
import type { RecordingStore, StoredRecording } from "./local-store";
import { buildActivityRecord } from "./record";

/*
 * Housekeeping for recordings kept on this device: which ones another FITX window is recording
 * right now, tidying rows a crash or a failed write left behind, and removing an account's data.
 */

/** The minimal Web Locks API used to mark a recording as live in one window. */
export type LocksLike = {
  request(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<void>): Promise<unknown>;
  query?(): Promise<{ held?: Array<{ name?: string }> }>;
};

export function recordingLockName(clientId: string): string {
  return `fitx-recording:${clientId}`;
}

/** Client ids of recordings some FITX window is recording now (empty when the browser can't tell). */
export async function busyRecordings(locks: LocksLike | null | undefined): Promise<Set<string>> {
  const busy = new Set<string>();
  if (!locks?.query) return busy;
  try {
    const state = await locks.query();
    for (const lock of state.held ?? []) {
      if (lock.name?.startsWith("fitx-recording:")) busy.add(lock.name.slice("fitx-recording:".length));
    }
  } catch {
    // No lock information: nothing is treated as busy.
  }
  return busy;
}

/** Holds the recording's lock until the returned function is called. */
export function holdRecordingLock(locks: LocksLike | null | undefined, clientId: string): () => void {
  if (!locks) return () => undefined;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  void locks.request(recordingLockName(clientId), {}, () => held).catch(() => undefined);
  return () => release();
}

/**
 * Tidies this account's unfinished rows that no window is recording:
 *  - a row whose log never started (a crash between creating it and its first write) is removed;
 *  - a row whose log already finished (the finished copy could not be written) becomes a finished
 *    record waiting to upload, so the activity is not lost.
 * Returns the account's rows afterwards.
 */
export async function reconcileRecordings(store: RecordingStore, userId: string, busy: ReadonlySet<string> = new Set()): Promise<StoredRecording[]> {
  for (const row of await store.listRecordings(userId)) {
    if (row.state !== "active" || busy.has(row.clientId)) continue;
    try {
      const entries = await store.readEntries(row.clientId);
      const engine = ActivityEngine.replay(entries);
      if (engine.status === "idle") {
        await store.deleteRecording(row.clientId);
      } else if (engine.status === "finished") {
        const record = buildActivityRecord(engine, { clientId: row.clientId, title: defaultTitle(row.sport, new Date(row.startedAt)), weightKg: null, log: entries });
        await store.saveRecording({ ...row, state: "finished", record, updatedAt: engine.endedAt ?? row.updatedAt, uploadAttempts: 0 });
      }
    } catch {
      // Leave the row as it is; it is tried again next time.
    }
  }
  return store.listRecordings(userId);
}

/** Removes every recording of the account from this device, and log entries no row owns any more. */
export async function clearDeviceActivityData(store: RecordingStore, userId: string): Promise<void> {
  await store.deleteAll(userId);
  await store.deleteOrphanEntries();
}
