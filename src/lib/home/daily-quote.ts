/**
 * Home's quote of the day: one quote per member per local day, never repeated while unseen ones remain.
 *
 * With migration 20261123100010 the database keeps the history (`daily_quote_history`) and picks the next
 * unseen quote (`fitx_daily_quote`), so a quote stays the same across reloads, sign-outs and devices and never
 * comes back. Before that migration (or while the database cannot be reached) the browser keeps the history in
 * localStorage, per member, and `stored` is false. Quotes seen that way are passed to the database the first
 * time it answers, so they are avoided there too.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUOTES, quoteById, type Quote, type QuoteTheme } from "@/data/quotes";

/** FNV-1a, 32 bits: a small, stable hash so the same member and day always give the same pick. */
export function hashKey(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The quote for `localDate`. Pure and deterministic: among the quotes not in `seen`, the one whose
 * hash of member, day and id is lowest (a fixed shuffle per member and day). When every quote is in `seen`,
 * the oldest seen quote comes back first; `seen` must therefore be in the order the quotes were shown.
 */
export function pickQuote(seen: ReadonlySet<string>, localDate: string, userId: string, library: readonly Quote[] = QUOTES): Quote {
  let best: Quote | null = null;
  let bestHash = Infinity;
  for (const quote of library) {
    if (seen.has(quote.id)) continue;
    const hash = hashKey(`${userId}:${localDate}:${quote.id}`);
    if (hash < bestHash || (hash === bestHash && best !== null && quote.id < best.id)) {
      best = quote;
      bestHash = hash;
    }
  }
  if (best) return best;
  for (const id of seen) {
    const oldest = library.find((quote) => quote.id === id);
    if (oldest) return oldest;
  }
  return library[0];
}

/** A YYYY-MM-DD day key. */
export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export type QuoteHistoryEntry = { date: string; id: string };

const HISTORY_PREFIX = "fitx-quote-history:";
/** More than the whole library, so "oldest first" still works after a full cycle. */
const HISTORY_LIMIT = 800;

export function historyKey(userId: string) {
  return `${HISTORY_PREFIX}${userId}`;
}

/** The entries of a stored history, oldest first; anything malformed is dropped. */
export function parseHistory(raw: string | null): QuoteHistoryEntry[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const entries = value.filter((entry): entry is QuoteHistoryEntry =>
      Boolean(entry) && typeof entry === "object" && isDayKey((entry as QuoteHistoryEntry).date) && typeof (entry as QuoteHistoryEntry).id === "string");
    return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  } catch {
    return [];
  }
}

/** The ids in the order they were shown, each once (a quote shown again moves to the end). */
export function seenInOrder(entries: readonly QuoteHistoryEntry[]): Set<string> {
  const seen = new Set<string>();
  for (const entry of entries) {
    seen.delete(entry.id);
    seen.add(entry.id);
  }
  return seen;
}

/**
 * The browser-only history: the day's quote if one was already picked for `localDate`, else a new pick, saved.
 * `storage` is null where localStorage is blocked; the pick is still deterministic for the member and day.
 */
export function localDailyQuote(storage: Pick<Storage, "getItem" | "setItem"> | null, userId: string, localDate: string): Quote {
  let entries: QuoteHistoryEntry[] = [];
  try {
    entries = parseHistory(storage?.getItem(historyKey(userId)) ?? null);
  } catch {
    entries = [];
  }
  const today = entries.find((entry) => entry.date === localDate);
  const known = today ? quoteById(today.id) : null;
  if (known) return known;
  const quote = pickQuote(seenInOrder(entries.filter((entry) => entry.date !== localDate)), localDate, userId);
  const next = [...entries.filter((entry) => entry.date !== localDate), { date: localDate, id: quote.id }].slice(-HISTORY_LIMIT);
  try {
    storage?.setItem(historyKey(userId), JSON.stringify(next));
  } catch {
    // Storage full or blocked: the quote still shows, it just is not remembered on this device.
  }
  return quote;
}

const THEMES: readonly QuoteTheme[] = ["discipline", "consistency", "strength", "mind", "growth", "recovery"];

type QuoteRow = { quote_id?: unknown; text?: unknown; author?: unknown; source?: unknown; theme?: unknown; scene?: unknown };

/** A row from `fitx_daily_quote` as a Quote: this build's copy when it knows the id, else the row itself. */
export function quoteFromRow(row: QuoteRow | null | undefined): Quote | null {
  if (!row || typeof row.quote_id !== "string") return null;
  const known = quoteById(row.quote_id);
  if (known) return known;
  if (typeof row.text !== "string" || !row.text.trim() || typeof row.scene !== "string") return null;
  const theme = THEMES.includes(row.theme as QuoteTheme) ? (row.theme as QuoteTheme) : "discipline";
  return {
    id: row.quote_id,
    text: row.text,
    author: typeof row.author === "string" ? row.author : null,
    source: typeof row.source === "string" ? row.source : null,
    theme,
    scene: row.scene,
  };
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The member's quote for `localDate`. `stored: true` when the database picked and keeps it; otherwise it comes
 * from this browser's history (before the migration, or when the database could not be reached).
 */
export async function getDailyQuote(
  supabase: Pick<SupabaseClient, "rpc"> | null,
  { userId, localDate, storage = browserStorage() }: { userId: string; localDate: string; storage?: Pick<Storage, "getItem" | "setItem"> | null },
): Promise<{ quote: Quote; stored: boolean }> {
  if (supabase && isDayKey(localDate)) {
    let avoid: string[] = [];
    try {
      avoid = [...seenInOrder(parseHistory(storage?.getItem(historyKey(userId)) ?? null))].slice(-HISTORY_LIMIT);
    } catch {
      avoid = [];
    }
    try {
      const { data, error } = await supabase.rpc("fitx_daily_quote", { p_local_date: localDate, p_avoid: avoid });
      // A missing function (before the migration) or any other error: the browser's history keeps Home working.
      if (!error) {
        const row = Array.isArray(data) ? (data[0] as QuoteRow | undefined) : (data as QuoteRow | null);
        const quote = quoteFromRow(row);
        if (quote) return { quote, stored: true };
      }
    } catch {
      // Offline: fall through to the browser's history.
    }
  }
  return { quote: localDailyQuote(storage, userId, localDate), stored: false };
}
