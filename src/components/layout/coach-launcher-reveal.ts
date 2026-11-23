/**
 * When the floating AI Coach button may show (CoachLauncher). Two answers decide it: the member's Settings choice
 * (lib/shell/coach-launcher-pref) and FITX Admin's AI coach switch (lib/shell/coach-switch). Each is cached on the
 * device, so a returning device shows the button at once, with no flash. On a first visit there is no cached answer:
 * the button then waits for the account's (and the switch's) answer instead of showing for the moment before it and
 * vanishing when the answer is "off".
 *
 * Pure, for tests; no imports.
 */

type Readable = Pick<Storage, "getItem">;

/** This device's last answer under `key` ("on" or "off"), or null when the device has none (a first visit). */
export function cachedAnswer(storage: Readable | null, key: string): boolean | null {
  try {
    const value = storage?.getItem(key) ?? null;
    return value === null ? null : value !== "off";
  } catch {
    // Storage blocked: nothing is cached, so the button waits for the answers.
    return null;
  }
}

/** The answer to go by: the fresh one once it came, else the device's cached one; null while neither is known. */
export function knownAnswer(fresh: boolean | null, cached: boolean | null): boolean | null {
  return fresh ?? cached;
}

