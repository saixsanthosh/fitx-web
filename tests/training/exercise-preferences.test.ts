import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addRecentSearch,
  cleanSearchTerm,
  clearRecentSearches,
  forgetSearch,
  idsReadingAs,
  idsToMove,
  loadSavedExercises,
  readExerciseFavorites,
  readRecentExercises,
  readRecentSearches,
  RECENT_EXERCISE_LIMIT,
  RECENT_SEARCH_LIMIT,
  rememberExercise,
  rememberSearch,
  setExerciseSaved,
  toggleExerciseFavorite,
  withExerciseSaved,
} from "@/lib/domain/exercise-preferences";

const USER = "11111111-1111-4111-8111-111111111111";

// Browser storage for the device lists (each test file runs in its own process).
const storage = new Map<string, string>();
const session = new Map<string, string>();
const fakeWindow = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)); },
    removeItem: (key: string) => { storage.delete(key); },
  },
  sessionStorage: {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => { session.set(key, String(value)); },
  },
};
before(() => { (globalThis as { window?: unknown }).window = fakeWindow; });
after(() => { delete (globalThis as { window?: unknown }).window; });
beforeEach(() => { storage.clear(); session.clear(); });

type Row = { user_id: string; exercise_id: string; created_at: string };
type Failure = { code: string; message: string };

/** exercise_favorites as PostgREST would answer: select/eq/order/limit, upsert with ignoreDuplicates, delete/eq/in. */
class FavoritesTable {
  rows: Row[] = [];
  /** null: the table does not exist (its migration is not applied). */
  exists = true;
  failRead: Failure | null = null;
  failWrite: Failure | null = null;
  writes: Array<{ op: string; payload?: unknown; filters: string[] }> = [];

  client() {
    return { from: (table: string) => this.query(table) } as unknown as Pick<SupabaseClient, "from">;
  }

  private query(table: string) {
    const filters: Array<[string, string, unknown]> = [];
    let op: "select" | "upsert" | "delete" = "select";
    let payload: unknown = null;
    let limit = Number.POSITIVE_INFINITY;
    const missing = { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => { filters.push([column, "eq", value]); return builder; },
      in: (column: string, values: unknown[]) => { filters.push([column, "in", values]); return builder; },
      order: () => builder,
      limit: (count: number) => { limit = count; return builder; },
      upsert: (rows: unknown) => { op = "upsert"; payload = rows; return builder; },
      delete: () => { op = "delete"; return builder; },
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve(this.execute(op, payload, filters, limit, missing)).then(resolve),
    };
    return builder;
  }

  private matches(row: Row, filters: Array<[string, string, unknown]>) {
    return filters.every(([column, operator, value]) => (operator === "eq" ? row[column as keyof Row] === value : (value as unknown[]).includes(row[column as keyof Row])));
  }

  private execute(op: string, payload: unknown, filters: Array<[string, string, unknown]>, limit: number, missing: Failure) {
    if (!this.exists) return { data: null, error: missing };
    if (op === "select") {
      if (this.failRead) return { data: null, error: this.failRead };
      return { data: this.rows.filter((row) => this.matches(row, filters)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit), error: null };
    }
    this.writes.push({ op, payload, filters: filters.map(([column, operator, value]) => `${column}=${operator}.${Array.isArray(value) ? value.join(",") : String(value)}`) });
    if (this.failWrite) return { data: null, error: this.failWrite };
    if (op === "upsert") {
      for (const row of (Array.isArray(payload) ? payload : [payload]) as Array<{ user_id: string; exercise_id: string }>) {
        if (!this.rows.some((item) => item.user_id === row.user_id && item.exercise_id === row.exercise_id)) this.rows.push({ ...row, created_at: new Date(Date.now() + this.rows.length).toISOString() });
      }
      return { data: null, error: null };
    }
    this.rows = this.rows.filter((row) => !this.matches(row, filters));
    return { data: null, error: null };
  }
}

describe("recent searches (this device)", () => {
  test("a search worth keeping: trimmed, single-spaced, at least two characters", () => {
    assert.equal(cleanSearchTerm("  bench   press "), "bench press");
    assert.equal(cleanSearchTerm("a"), null);
    assert.equal(cleanSearchTerm(" "), null);
    assert.equal(cleanSearchTerm("x".repeat(120))?.length, 80);
  });

  test("newest first, repeats moved up ignoring case, at most eight", () => {
    let list: string[] = [];
    for (const term of ["rdl", "bench press", "Pull ups", "RDL"]) list = addRecentSearch(list, term);
    assert.deepEqual(list, ["RDL", "Pull ups", "bench press"]);
    for (let index = 0; index < 12; index += 1) list = addRecentSearch(list, `term ${index}`);
    assert.equal(list.length, RECENT_SEARCH_LIMIT);
    assert.equal(list[0], "term 11");
  });

  test("kept per user on this device; one can be forgotten, or all", () => {
    rememberSearch(USER, "skull crusher");
    rememberSearch(USER, "ohp");
    assert.deepEqual(readRecentSearches(USER), ["ohp", "skull crusher"]);
    assert.deepEqual(readRecentSearches("someone-else"), []);
    assert.deepEqual(forgetSearch(USER, "OHP"), ["skull crusher"]);
    assert.deepEqual(clearRecentSearches(USER), []);
    assert.deepEqual(readRecentSearches(USER), []);
    assert.equal([...storage.keys()].some((key) => key.endsWith(":searches")), false, "an empty list leaves nothing behind");
  });

  test("browser storage that is blocked never breaks the library", () => {
    const original = fakeWindow.localStorage.getItem;
    fakeWindow.localStorage.getItem = () => { throw new Error("blocked"); };
    try {
      assert.deepEqual(readRecentSearches(USER), []);
      assert.deepEqual(rememberSearch(USER, "squat"), ["squat"]);
    } finally {
      fakeWindow.localStorage.getItem = original;
    }
  });

  test("recently viewed keeps the newest eight", () => {
    for (let index = 0; index < 10; index += 1) rememberExercise(USER, `exercise_${index}`);
    rememberExercise(USER, "exercise_3");
    const recent = readRecentExercises(USER);
    assert.equal(recent.length, RECENT_EXERCISE_LIMIT);
    assert.equal(recent[0], "exercise_3");
  });
});

describe("saved exercises: the account when exercise_favorites exists, else this device", () => {
  test("one exercise saved or removed, the rest of the list untouched", () => {
    assert.deepEqual(withExerciseSaved(["a", "b"], "c", true), ["c", "a", "b"]);
    assert.deepEqual(withExerciseSaved(["c", "a", "b"], "c", true), ["c", "a", "b"], "saving twice keeps one copy");
    assert.deepEqual(withExerciseSaved(["a", "b"], "a", false), ["b"]);
    assert.deepEqual(withExerciseSaved(["a"], "missing", false), ["a"]);
    assert.deepEqual(withExerciseSaved(["bench_press", "pull_up"], "free-exercise-db-Pullups", false), ["bench_press"], "a merged duplicate reads as its survivor");
    // Save A, then B; A fails: undoing only A keeps B.
    const afterBoth = withExerciseSaved(withExerciseSaved([], "a", true), "b", true);
    assert.deepEqual(withExerciseSaved(afterBoth, "a", false), ["b"]);
  });

  test("ids that read as an exercise include the duplicates merged into it", () => {
    assert.deepEqual(idsReadingAs("pull_up"), ["pull_up", "free-exercise-db-Pullups"]);
    assert.deepEqual(idsReadingAs("free-exercise-db-Pullups"), ["pull_up", "free-exercise-db-Pullups"]);
    assert.deepEqual(idsReadingAs("goblet_squat"), ["goblet_squat"]);
    assert.deepEqual(idsToMove(["free-exercise-db-Pushups", "bench_press", "gone"], ["bench_press"], new Set(["push_up", "bench_press"])), ["push_up"]);
  });

  test("before the table exists: this device's list, read as survivors", async () => {
    const table = new FavoritesTable();
    table.exists = false;
    toggleExerciseFavorite(USER, "free-exercise-db-Pullups");
    toggleExerciseFavorite(USER, "goblet_squat");
    const saved = await loadSavedExercises(table.client(), USER);
    assert.deepEqual([saved.store, saved.ids, saved.error, saved.moved], ["device", ["goblet_squat", "pull_up"], null, 0]);
    assert.deepEqual(readExerciseFavorites(USER), ["goblet_squat", "free-exercise-db-Pullups"], "nothing is cleared");
    const off = await setExerciseSaved(table.client(), USER, "device", "pull_up", false);
    assert.equal(off.error, null);
    assert.deepEqual(readExerciseFavorites(USER), ["goblet_squat"], "un-saving removes the merged duplicate's id too");
    await setExerciseSaved(table.client(), USER, "device", "push_up", true);
    assert.deepEqual(readExerciseFavorites(USER), ["push_up", "goblet_squat"]);
    assert.equal(table.writes.length, 0);
  });

  test("a missing table is asked about once per browser tab", async () => {
    const table = new FavoritesTable();
    table.exists = false;
    let reads = 0;
    const counting = { from: (name: string) => { reads += 1; return table.client().from(name); } } as unknown as Pick<SupabaseClient, "from">;
    await loadSavedExercises(counting, USER);
    await loadSavedExercises(counting, USER);
    assert.equal(reads, 1);
    session.clear();
    table.exists = true;
    assert.equal((await loadSavedExercises(counting, USER)).store, "account", "a new tab finds the table once it exists");
  });

  test("with the table: device-saved exercises move into the account once, then the device list is cleared", async () => {
    const table = new FavoritesTable();
    table.rows.push({ user_id: USER, exercise_id: "bench_press", created_at: "2026-11-01T10:00:00Z" });
    table.rows.push({ user_id: "someone-else", exercise_id: "plank", created_at: "2026-11-01T10:00:00Z" });
    toggleExerciseFavorite(USER, "bench_press");
    toggleExerciseFavorite(USER, "free-exercise-db-Pushups");
    toggleExerciseFavorite(USER, "no_longer_in_catalogue");
    const known = new Set(["bench_press", "push_up", "plank"]);
    const first = await loadSavedExercises(table.client(), USER, { knownIds: known });
    assert.equal(first.store, "account");
    assert.equal(first.moved, 1);
    assert.deepEqual([...first.ids].sort(), ["bench_press", "push_up"]);
    assert.deepEqual(table.writes.map((write) => [write.op, write.payload]), [["upsert", [{ user_id: USER, exercise_id: "push_up" }]]]);
    assert.deepEqual(readExerciseFavorites(USER), [], "the device list is cleared after the move");
    const second = await loadSavedExercises(table.client(), USER, { knownIds: known });
    assert.deepEqual([second.moved, table.writes.length], [0, 1], "nothing is moved twice");
  });

  test("a failed move keeps the device list for next time and shows both meanwhile", async () => {
    const table = new FavoritesTable();
    table.failWrite = { code: "42501", message: "permission denied" };
    toggleExerciseFavorite(USER, "goblet_squat");
    const saved = await loadSavedExercises(table.client(), USER);
    assert.deepEqual([saved.store, saved.ids, saved.moved, saved.error], ["account", ["goblet_squat"], 0, null]);
    assert.deepEqual(readExerciseFavorites(USER), ["goblet_squat"]);
    // Un-saving it then removes the waiting device copy too, so it does not come back.
    table.failWrite = null;
    assert.equal((await setExerciseSaved(table.client(), USER, "account", "goblet_squat", false)).error, null);
    assert.deepEqual(readExerciseFavorites(USER), []);
    assert.deepEqual((await loadSavedExercises(table.client(), USER)).ids, []);
  });

  test("a read error falls back to this device's list and says so", async () => {
    const table = new FavoritesTable();
    table.failRead = { code: "57014", message: "canceling statement due to statement timeout" };
    toggleExerciseFavorite(USER, "plank");
    const saved = await loadSavedExercises(table.client(), USER);
    assert.deepEqual([saved.store, saved.ids, (saved.error as Failure).code], ["device", ["plank"], "57014"]);
    const offline = await loadSavedExercises(null, USER);
    assert.deepEqual([offline.store, offline.ids, offline.error], ["device", ["plank"], null]);
  });

  test("saving and un-saving in the account", async () => {
    const table = new FavoritesTable();
    table.rows.push({ user_id: USER, exercise_id: "free-exercise-db-Pullups", created_at: "2026-11-01T10:00:00Z" });
    assert.equal((await setExerciseSaved(table.client(), USER, "account", "free-exercise-db-Barbell_Squat", true)).error, null);
    assert.deepEqual(table.rows.filter((row) => row.user_id === USER).map((row) => row.exercise_id).sort(), ["barbell_back_squat", "free-exercise-db-Pullups"], "saved under the survivor's id");
    assert.equal((await setExerciseSaved(table.client(), USER, "account", "pull_up", false)).error, null);
    assert.deepEqual(table.writes.at(-1)?.filters, [`user_id=eq.${USER}`, "exercise_id=in.pull_up,free-exercise-db-Pullups"]);
    assert.deepEqual(table.rows.filter((row) => row.user_id === USER).map((row) => row.exercise_id), ["barbell_back_squat"]);
    table.failWrite = { code: "08006", message: "connection failure" };
    assert.equal(((await setExerciseSaved(table.client(), USER, "account", "plank", true)).error as Failure).code, "08006");
  });
});
