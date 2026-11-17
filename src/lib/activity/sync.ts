import { busyRecordings, clearDeviceActivityData, reconcileRecordings, type LocksLike } from "./device-recordings";
import type { RecordingStore, StoredRecording } from "./local-store";
import { saveActivity, type DbResult, type SupabaseLike } from "./repository";

export type UploadOutcome = { clientId: string; result: DbResult<{ id: string }> };

/**
 * Uploads one finished recording kept on this device. On success it is removed from the device;
 * otherwise the attempt is noted and it stays for a later retry.
 */
export async function uploadRecording(store: RecordingStore, client: SupabaseLike, userId: string, recording: StoredRecording): Promise<UploadOutcome> {
  if (!recording.record || recording.userId !== userId) {
    return { clientId: recording.clientId, result: { status: "error", message: "Nothing to upload", offline: false } };
  }
  const result = await saveActivity(client, userId, recording.record);
  if (result.status === "ok") {
    await store.deleteRecording(recording.clientId).catch(() => undefined);
  } else {
    const note = result.status === "unavailable" ? "Activity history is not available yet" : result.message;
    // Kept on the device either way (it may be the only copy); a rejected one is not retried.
    await store.saveRecording({
      ...recording,
      state: "finished",
      uploadAttempts: (recording.uploadAttempts ?? 0) + 1,
      lastUploadError: note,
      uploadRejected: result.status === "rejected" || undefined,
      updatedAt: Date.now(),
    }).catch(() => undefined);
  }
  return { clientId: recording.clientId, result };
}

/** Uploads every finished recording of the account still on this device (oldest first). */
export async function uploadPending(store: RecordingStore, client: SupabaseLike, userId: string): Promise<UploadOutcome[]> {
  const waiting = (await store.listRecordings(userId)).filter((r) => r.state === "finished" && r.record && !r.uploadRejected).sort((a, b) => a.startedAt - b.startedAt);
  const outcomes: UploadOutcome[] = [];
  for (const recording of waiting) {
    const outcome = await uploadRecording(store, client, userId, recording);
    outcomes.push(outcome);
    // The same answer applies to the rest: no point repeating it.
    if (outcome.result.status === "unavailable" || (outcome.result.status === "error" && outcome.result.offline)) break;
  }
  return outcomes;
}

/**
 * Before signing out: tidy and upload what this device still holds for the account, and say how
 * many recordings would be lost if it were cleared now (unfinished, or not uploaded).
 */
export async function prepareActivitySignOut(store: RecordingStore, client: SupabaseLike, userId: string, locks?: LocksLike | null): Promise<{ notUploaded: number }> {
  await reconcileRecordings(store, userId, await busyRecordings(locks));
  await uploadPending(store, client, userId);
  return { notUploaded: (await store.listRecordings(userId)).length };
}

/** Removes the account's recordings from this device (after prepareActivitySignOut, or on account deletion). */
export async function clearActivityDataOnSignOut(store: RecordingStore, userId: string): Promise<void> {
  await clearDeviceActivityData(store, userId);
}
