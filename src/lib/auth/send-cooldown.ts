/**
 * A cooldown in this browser for everything that makes Supabase send an email (sign-in codes, sign-up confirmation,
 * password-reset links), on top of Supabase Auth's own server-side limits. It stops one browser from sending email
 * after email by switching addresses, reloading or going back: at most one email a minute to the same address and
 * at most EMAILS_PER_WINDOW emails in WINDOW_MS from this browser. Stored in localStorage, so a reload or another
 * tab sees it; private windows and blocked storage fall back to memory. It is a courtesy, not a defence: Supabase's
 * limits (and a bot check, if the owner adds one) are what hold against scripts.
 *
 * Pure apart from `browserEmailCooldown()`, so node:test covers the rules.
 */

export const SAME_ADDRESS_SECONDS = 60;
export const EMAILS_PER_WINDOW = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const STORAGE_KEY = "fitx-email-sends";

export type EmailSend = { at: number; address: string };

/** Lower-case, trimmed: the address as the cooldown compares it. Only a short hash-like key is kept. */
export function addressKey(address: string): string {
  const value = address.trim().toLowerCase();
  // FNV-1a: the stored list never holds the address itself.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Sends still inside the window, newest last; anything malformed is dropped. */
export function recentSends(raw: unknown, now: number): EmailSend[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is EmailSend => Boolean(item) && typeof item.at === "number" && typeof item.address === "string" && item.at <= now && item.at > now - WINDOW_MS)
    .sort((a, b) => a.at - b.at)
    .slice(-EMAILS_PER_WINDOW);
}

/** Seconds to wait before another email to `address` may be asked for, or 0. */
export function secondsUntilNextSend(sends: readonly EmailSend[], address: string, now: number): number {
  const key = addressKey(address);
  let wait = 0;
  const lastToAddress = [...sends].reverse().find((send) => send.address === key);
  if (lastToAddress) wait = Math.max(wait, lastToAddress.at + SAME_ADDRESS_SECONDS * 1000 - now);
  if (sends.length >= EMAILS_PER_WINDOW) wait = Math.max(wait, sends[sends.length - EMAILS_PER_WINDOW].at + WINDOW_MS - now);
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

/** The list after recording a send to `address` at `now`. */
export function withSend(sends: readonly EmailSend[], address: string, now: number): EmailSend[] {
  return recentSends([...sends, { at: now, address: addressKey(address) }], now);
}

/** "Wait 42 s" style message for the forms. */
export function cooldownMessage(seconds: number): string {
  if (seconds <= 90) return `Wait ${seconds} s, then try again.`;
  return `Too many emails sent from this browser. Try again in ${Math.ceil(seconds / 60)} min.`;
}

export type EmailCooldown = {
  /** Seconds to wait before an email to `address`, or 0. */
  wait(address: string): number;
  /** Call once Supabase accepted the request (an email is on its way). */
  record(address: string): void;
};

/** The cooldown over a storage (localStorage in the browser, anything with the same two methods in tests). */
export function createEmailCooldown(storage: Pick<Storage, "getItem" | "setItem"> | null, clock: () => number = Date.now): EmailCooldown {
  let memory: EmailSend[] = [];
  const read = (now: number): EmailSend[] => {
    if (!storage) return recentSends(memory, now);
    try {
      return recentSends(JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]"), now);
    } catch {
      return recentSends(memory, now);
    }
  };
  const write = (sends: EmailSend[]) => {
    memory = sends;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(sends));
    } catch {
      // Storage full or blocked: memory keeps the count for this page.
    }
  };
  return {
    wait(address) {
      const now = clock();
      return secondsUntilNextSend(read(now), address, now);
    },
    record(address) {
      const now = clock();
      write(withSend(read(now), address, now));
    },
  };
}

let shared: EmailCooldown | null = null;

/** The browser's cooldown (one per page load), backed by localStorage when it is available. */
export function browserEmailCooldown(): EmailCooldown {
  if (shared) return shared;
  let storage: Storage | null = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    storage = null;
  }
  shared = createEmailCooldown(storage);
  return shared;
}
