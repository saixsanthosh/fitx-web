/**
 * Home's quote of the day: one quote per member per local day, never repeated while unseen ones remain.
 *
 * With migration 20261123100010 the database keeps the history (`daily_quote_history`) and picks the next
 * unseen quote (`fitx_daily_quote`), so a quote stays the same across reloads, sign-outs and devices and never
 * comes back. The browser keeps its own history in localStorage, per member: every quote the database picks is
 * recorded there for its day (bug 70), so while the database can't be reached for a moment Home keeps showing the
 * quote this device last showed that day, with its scene, instead of a different one. Only when this device has no
 * quote for the day yet (before the migration, or the day's first visit falls in an outage) does it pick one itself
 * (`stored` is false); quotes picked that way are passed to the database when it next answers, so they are avoided
 * there too.
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

/** `stored`: the database picked it (and keeps it); without it, this browser picked it while the database couldn't. */
export type QuoteHistoryEntry = { date: string; id: string; stored?: true };

const HISTORY_PREFIX = "fitx-quote-history:";
/** More than the whole library, so "oldest first" still works after a full cycle. */
const HISTORY_LIMIT = 800;

export function historyKey(userId: string) {
  return `${HISTORY_PREFIX}${userId}`;
}

/**
 * The entries of a stored history, oldest first (in the order shown within a day); anything malformed is dropped.
 */
export function parseHistory(raw: string | null): QuoteHistoryEntry[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const entries = value
      .filter((entry): entry is QuoteHistoryEntry =>
        Boolean(entry) && typeof entry === "object" && isDayKey((entry as QuoteHistoryEntry).date) && typeof (entry as QuoteHistoryEntry).id === "string")
      .map((entry): QuoteHistoryEntry => (entry.stored === true ? { date: entry.date, id: entry.id, stored: true } : { date: entry.date, id: entry.id }));
    // A stable sort: entries of the same day keep the order they were shown in.
    return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  } catch {
    return [];
  }
}

function readHistory(storage: Pick<Storage, "getItem"> | null, userId: string): QuoteHistoryEntry[] {
  try {
    return parseHistory(storage?.getItem(historyKey(userId)) ?? null);
  } catch {
    return [];
  }
}

function writeHistory(storage: Pick<Storage, "setItem"> | null, userId: string, entries: readonly QuoteHistoryEntry[]) {
  try {
    storage?.setItem(historyKey(userId), JSON.stringify(entries.slice(-HISTORY_LIMIT)));
  } catch {
    // Storage full or blocked: the quote still shows, it just is not remembered on this device.
  }
}

/** The quote this device last showed on `localDate`, when this build knows it. */
function shownOn(entries: readonly QuoteHistoryEntry[], localDate: string): Quote | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].date !== localDate) continue;
    const known = quoteById(entries[index].id);
    if (known) return known;
  }
  return null;
}

/**
 * Records the quote the database picked for `localDate` as the day's quote on this device, after any quote this
 * device picked itself earlier that day (kept as seen, so it isn't picked again here or by the database).
 */
export function rememberStoredQuote(storage: Pick<Storage, "getItem" | "setItem"> | null, userId: string, localDate: string, quoteId: string): void {
  const entries = readHistory(storage, userId);
  const last = entries.filter((entry) => entry.date === localDate).at(-1);
  if (last?.id === quoteId && last.stored) return;
  writeHistory(storage, userId, [...entries.filter((entry) => !(entry.date === localDate && entry.id === quoteId)), { date: localDate, id: quoteId, stored: true }]);
}

/** Quotes this device picked itself (the database doesn't know them), oldest first, each once. */
export function localOnlyQuotes(entries: readonly QuoteHistoryEntry[]): string[] {
  return [...seenInOrder(entries.filter((entry) => !entry.stored))];
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
 * The browser's history: the quote this device last showed on `localDate` (the database's, once it has answered that
 * day), else a new pick, saved. `storage` is null where localStorage is blocked; the pick is still deterministic for
 * the member and day.
 */
export function localDailyQuote(storage: Pick<Storage, "getItem" | "setItem"> | null, userId: string, localDate: string): Quote {
  const entries = readHistory(storage, userId);
  const shown = shownOn(entries, localDate);
  if (shown) return shown;
  const quote = pickQuote(seenInOrder(entries.filter((entry) => entry.date !== localDate)), localDate, userId);
  writeHistory(storage, userId, [...entries, { date: localDate, id: quote.id }]);
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
    // Only the quotes this device picked itself: the database already knows its own.
    const avoid = localOnlyQuotes(readHistory(storage, userId)).slice(-HISTORY_LIMIT);
    try {
      const { data, error } = await supabase.rpc("fitx_daily_quote", { p_local_date: localDate, p_avoid: avoid });
      // A missing function (before the migration) or any other error: the browser's history keeps Home working.
      if (!error) {
        const row = Array.isArray(data) ? (data[0] as QuoteRow | undefined) : (data as QuoteRow | null);
        const quote = quoteFromRow(row);
        if (quote) {
          // Kept on this device too, so a moment when the database can't be reached shows this same quote.
          rememberStoredQuote(storage, userId, localDate, quote.id);
          return { quote, stored: true };
        }
      }
    } catch {
      // Offline: fall through to the browser's history.
    }
  }
  return { quote: localDailyQuote(storage, userId, localDate), stored: false };
}
