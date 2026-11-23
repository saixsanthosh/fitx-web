/**
 * The coach's one-time prompt for a member who agreed to an older consent screen (version 1, before 23 November
 * 2026): what agreeing again would add, in plain words, and the device's memory that the prompt was answered. Pure,
 * for tests (status.ts ConsentRenewal is the data it reads).
 */
import type { ConsentRenewal } from "@/lib/ai/status";

/** localStorage: set to "seen" once the member agreed or chose "Not now" for this consent version on this device. */
export const renewalSeenKey = (version: number) => `fitx-coach-renewal-v${version}`;

type Storageish = Pick<Storage, "getItem" | "setItem">;

export function renewalSeen(storage: Storageish | null, version: number): boolean {
  try {
    return storage?.getItem(renewalSeenKey(version)) === "seen";
  } catch {
    return false;
  }
}

export function markRenewalSeen(storage: Storageish | null, version: number): void {
  try {
    storage?.setItem(renewalSeenKey(version), "seen");
  } catch {
    // Storage blocked: the prompt may come back on the next visit, which only offers the same choice again.
  }
}

/** "A, B and C" in British English (no serial comma). */
function list(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The prompt's text: what the newer consent screen adds, and that nothing changes without a yes. */
export function renewalText(renewal: Pick<ConsentRenewal, "services" | "activities">): string {
  const activities = "the coach can also read your walks, runs and rides (totals only, never routes)";
  const services = renewal.services.length
    ? `${list(renewal.services)} ${renewal.services.length === 1 ? "was added as an AI service" : "were added as AI services"} for your FITX data`
    : "";
  const added = renewal.activities && services ? `${activities}, and ${services}` : renewal.activities ? activities : services;
  return `Since you agreed, ${added}. Nothing changes unless you agree to the updated terms.`;
}
