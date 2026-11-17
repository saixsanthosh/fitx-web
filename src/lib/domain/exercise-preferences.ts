import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/domain/schema-fallback";
import { MERGED_EXERCISE_IDS, survivingExerciseId, survivingExerciseIds } from "@/lib/training/exercise-merges";

/**
 * A member's exercise conveniences.
 *  - Saved exercises live in the account (`public.exercise_favorites`, owner-only) so they follow the member to
 *    every device. Until that table exists in a database, they stay in this browser's storage; the first load that
 *    finds the table moves them into the account once, and only then clears them here.
 *  - Recently viewed exercises and recent searches stay on this device (browser storage, per user).
 * Browser storage may be missing, full or blocked: every read falls back to nothing and every write is optional.
 */

const STORAGE_VERSION = "v1";
type Kind = "favorites" | "recent" | "searches";

function storageKey(userId: string, kind: Kind) {
  return `fitx:exercise:${STORAGE_VERSION}:${userId}:${kind}`;
}

function readList(userId: string, kind: Kind): string[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey(userId, kind)) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeList(userId: string, kind: Kind, items: readonly string[]) {
  if (typeof window === "undefined" || !userId) return;
  try {
    if (items.length) window.localStorage.setItem(storageKey(userId, kind), JSON.stringify(items));
    else window.localStorage.removeItem(storageKey(userId, kind));
  } catch {
    // Browser storage may be disabled or full; the rest of the library remains usable.
  }
}

// ---------------------------------------------------------------- saved on this device (before the table exists)

export function readExerciseFavorites(userId: string) {
  return readList(userId, "favorites");
}

export function toggleExerciseFavorite(userId: string, exerciseId: string) {
  const current = readList(userId, "favorites");
  const next = current.includes(exerciseId)
    ? current.filter((id) => id !== exerciseId)
    : [exerciseId, ...current];
  writeList(userId, "favorites", next);
  return next;
}

// ---------------------------------------------------------------- recently viewed (this device)

export const RECENT_EXERCISE_LIMIT = 8;

export function readRecentExercises(userId: string) {
  return readList(userId, "recent");
}

export function rememberExercise(userId: string, exerciseId: string) {
  const next = [exerciseId, ...readList(userId, "recent").filter((id) => id !== exerciseId)].slice(0, RECENT_EXERCISE_LIMIT);
  writeList(userId, "recent", next);
  return next;
}

// ---------------------------------------------------------------- recent searches (this device)

export const RECENT_SEARCH_LIMIT = 8;
export const MIN_SEARCH_LENGTH = 2;
export const MAX_SEARCH_LENGTH = 80;

/** A search worth remembering: trimmed and single-spaced; null when too short. */
export function cleanSearchTerm(term: string): string | null {
  const clean = String(term ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_LENGTH).trim();
  return clean.length >= MIN_SEARCH_LENGTH ? clean : null;
}

/** `term` first, then the earlier searches without it (compared ignoring case), at most RECENT_SEARCH_LIMIT. */
export function addRecentSearch(list: readonly string[], term: string): string[] {
  const clean = cleanSearchTerm(term);
  if (!clean) return [...list];
  const key = clean.toLowerCase();
  return [clean, ...list.filter((item) => item.toLowerCase() !== key)].slice(0, RECENT_SEARCH_LIMIT);
}

export function readRecentSearches(userId: string) {
  return readList(userId, "searches").map(cleanSearchTerm).filter((item): item is string => Boolean(item)).slice(0, RECENT_SEARCH_LIMIT);
}

export function rememberSearch(userId: string, term: string) {
  const next = addRecentSearch(readRecentSearches(userId), term);
  writeList(userId, "searches", next);
  return next;
}

export function forgetSearch(userId: string, term: string) {
  const key = term.trim().toLowerCase();
  const next = readRecentSearches(userId).filter((item) => item.toLowerCase() !== key);
  writeList(userId, "searches", next);
  return next;
}

export function clearRecentSearches(userId: string) {
  writeList(userId, "searches", []);
  return [] as string[];
}

// ---------------------------------------------------------------- saved exercises in the account

type Db = Pick<SupabaseClient, "from">;

const TABLE = "exercise_favorites";
/** Saved exercises read at most (newest first). */
export const MAX_SAVED_EXERCISES = 500;
/** Remembered for this browser tab once the table is found missing, so each page does not ask again. */
const TABLE_MISSING_KEY = `fitx:exercise:${STORAGE_VERSION}:favorites-table-missing`;

function tableKnownMissing(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(TABLE_MISSING_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberTableMissing() {
  try {
    window.sessionStorage.setItem(TABLE_MISSING_KEY, "1");
  } catch {
    // Without session storage the next page simply asks again.
  }
}

/** Where saved exercises are kept: the account (exercise_favorites) or, before that table exists, this device. */
export type SavedStore = "account" | "device";

export type SavedExercises = {
  store: SavedStore;
  /** Saved exercise ids, newest first, merged duplicates read as their survivor. */
  ids: string[];
  /** The stored ids as they are (an exercise merged since may be saved under its old id). */
  storedIds: string[];
  /** Set when the account's list could not be read; `ids` then holds this device's list. */
  error: unknown | null;
  /** How many device-saved exercises were moved into the account by this load. */
  moved: number;
};

/** Every id that reads as `exerciseId`: itself and the duplicates merged into it. */
export function idsReadingAs(exerciseId: string): string[] {
  const survivor = survivingExerciseId(exerciseId);
  return [survivor, ...Object.keys(MERGED_EXERCISE_IDS).filter((id) => MERGED_EXERCISE_IDS[id] === survivor)];
}

/**
 * A saved list with one exercise saved (first) or removed, every other id left as it is. For optimistic updates
 * and for undoing just that exercise when its request fails, while other saves may still be on their way.
 */
export function withExerciseSaved(ids: readonly string[], exerciseId: string, saved: boolean): string[] {
  const reading = new Set(idsReadingAs(exerciseId));
  const without = ids.filter((id) => !reading.has(id));
  return saved ? [survivingExerciseId(exerciseId), ...without] : without;
}

/**
 * The ids to move from this device into the account: those not saved there yet, read as their survivor, and (when
 * `knownIds` is given) only exercises the catalogue still has, so a stale id never fails the insert.
 */
export function idsToMove(deviceIds: readonly string[], accountIds: readonly string[], knownIds?: ReadonlySet<string> | null): string[] {
  const inAccount = new Set(survivingExerciseIds(accountIds));
  return survivingExerciseIds(deviceIds).filter((id) => !inAccount.has(id) && (!knownIds || knownIds.has(id)));
}

/**
 * Loads saved exercises. With the table: the account's list, after moving any device-saved ones into it once
 * (the device list is cleared only when that insert worked). Without the table (its migration not applied):
 * this device's list. On a read error: this device's list and the error.
 */
export async function loadSavedExercises(db: Db | null, userId: string, options: { knownIds?: ReadonlySet<string> | null } = {}): Promise<SavedExercises> {
  const device = readExerciseFavorites(userId);
  const onDevice = (error: unknown | null): SavedExercises => ({ store: "device", ids: survivingExerciseIds(device), storedIds: device, error, moved: 0 });
  if (!db || !userId || tableKnownMissing()) return onDevice(null);
  const result = await db.from(TABLE).select("exercise_id,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(MAX_SAVED_EXERCISES);
  if (result.error) {
    if (!isMissingTableError(result.error)) return onDevice(result.error);
    rememberTableMissing();
    return onDevice(null);
  }
  let stored = ((result.data ?? []) as Array<{ exercise_id: string }>).map((row) => row.exercise_id).filter((id) => typeof id === "string");
  let moved = 0;
  const move = idsToMove(device, stored, options.knownIds);
  if (move.length) {
    // created_at is left to the database: when they were first saved on the device is not known.
    const rows = move.map((exerciseId) => ({ user_id: userId, exercise_id: exerciseId }));
    const inserted = await db.from(TABLE).upsert(rows, { onConflict: "user_id,exercise_id", ignoreDuplicates: true });
    if (!inserted.error) {
      moved = move.length;
      stored = [...move, ...stored];
      writeList(userId, "favorites", []);
    } else {
      // Nothing is lost: the device keeps its list and the next load tries again. Show both meanwhile.
      stored = [...stored, ...move];
    }
  } else if (device.length) {
    // Everything on this device is already in the account (or no longer in the catalogue).
    writeList(userId, "favorites", []);
  }
  return { store: "account", ids: survivingExerciseIds(stored), storedIds: stored, error: null, moved };
}

/**
 * Saves or un-saves one exercise where the list lives. Un-saving removes every stored id that reads as the
 * exercise (a duplicate merged into it included). Returns the error, if any; the caller restores its list then.
 */
export async function setExerciseSaved(db: Db | null, userId: string, store: SavedStore, exerciseId: string, saved: boolean): Promise<{ error: unknown | null }> {
  if (!userId) return { error: null };
  const id = survivingExerciseId(exerciseId);
  if (store === "device" || !db) {
    const current = readExerciseFavorites(userId);
    const reading = new Set(idsReadingAs(id));
    const without = current.filter((item) => !reading.has(item));
    writeList(userId, "favorites", saved ? [id, ...without] : without);
    return { error: null };
  }
  if (saved) {
    const result = await db.from(TABLE).upsert({ user_id: userId, exercise_id: id }, { onConflict: "user_id,exercise_id", ignoreDuplicates: true });
    return { error: result.error ?? null };
  }
  const result = await db.from(TABLE).delete().eq("user_id", userId).in("exercise_id", idsReadingAs(id));
  if (!result.error) {
    // A copy still waiting on this device (its move failed earlier) must not come back on the next load.
    const reading = new Set(idsReadingAs(id));
    const device = readExerciseFavorites(userId);
    if (device.some((item) => reading.has(item))) writeList(userId, "favorites", device.filter((item) => !reading.has(item)));
  }
  return { error: result.error ?? null };
}
