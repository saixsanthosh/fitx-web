import type { UploadOutcome } from "./sync";

/*
 * Finishing an activity never waits on the network. The finished recording is already on the
 * device (IndexedDB) when the upload starts; if the upload hasn't worked within a few seconds (no
 * signal, a slow connection, the service down), the Record screen shows the result from the device
 * copy at once, and the upload carries on or is retried later (when the browser is back online,
 * from "Upload now", or the next time Activity opens).
 */

/** How long finishing waits for the upload before showing the result from the device copy. */
export const FINISH_UPLOAD_TIMEOUT_MS = 10_000;

export type KeptReason = "offline" | "timeout" | "unavailable" | "rejected" | "error";
export type FinishUpload =
  | { kind: "uploaded"; id: string }
  /** Still only on the device. `pending` is the upload still running after a timeout (it may yet work). */
  | { kind: "kept"; reason: KeptReason; pending: Promise<UploadOutcome> | null };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function uploadWithin(start: () => Promise<UploadOutcome>, timeoutMs: number = FINISH_UPLOAD_TIMEOUT_MS, timer: (ms: number) => Promise<void> = wait): Promise<FinishUpload> {
  let pending: Promise<UploadOutcome>;
  try {
    pending = start();
  } catch {
    return { kind: "kept", reason: "error", pending: null };
  }
  const settled = pending.then((outcome) => ({ done: true as const, outcome }), () => ({ done: true as const, outcome: null }));
  const winner = await Promise.race([settled, timer(timeoutMs).then(() => ({ done: false as const, outcome: null }))]);
  if (!winner.done) return { kind: "kept", reason: "timeout", pending };
  const result = winner.outcome?.result;
  if (!result) return { kind: "kept", reason: "error", pending: null };
  if (result.status === "ok") return { kind: "uploaded", id: result.data.id };
  if (result.status === "error") return { kind: "kept", reason: result.offline ? "offline" : "error", pending: null };
  return { kind: "kept", reason: result.status, pending: null };
}
