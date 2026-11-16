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
    await store.saveRecording({ ...recording, uploadAttempts: (recording.uploadAttempts ?? 0) + 1, lastUploadError: note, updatedAt: Date.now() }).catch(() => undefined);
  }
  return { clientId: recording.clientId, result };
}

/** Uploads every finished recording of the account still on this device (oldest first). */
export async function uploadPending(store: RecordingStore, client: SupabaseLike, userId: string): Promise<UploadOutcome[]> {
  const waiting = (await store.listRecordings(userId)).filter((r) => r.state === "finished" && r.record).sort((a, b) => a.startedAt - b.startedAt);
  const outcomes: UploadOutcome[] = [];
  for (const recording of waiting) {
    const outcome = await uploadRecording(store, client, userId, recording);
    outcomes.push(outcome);
    // The same answer applies to the rest: no point repeating it.
    if (outcome.result.status === "unavailable" || (outcome.result.status === "error" && outcome.result.offline)) break;
  }
  return outcomes;
}
