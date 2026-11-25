// Home's quote of the day during a brief outage (bug 70): the database's quote was never kept on the device, so each
// reload that couldn't reach fitx_daily_quote showed a different local quote (and scene) for the same day
// (src/lib/home/daily-quote.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { quoteById } from "@/data/quotes";
import { getDailyQuote, historyKey, localOnlyQuotes, parseHistory, rememberStoredQuote } from "@/lib/home/daily-quote";

const USER = "22222222-3333-4444-8555-666666666666";
const DAY = "2026-11-26";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}

/** fitx_daily_quote that answers `pick` for any day while `up`, and a 503 while not; it records what it was asked. */
function database(pick: () => string) {
  const calls: Array<{ p_local_date: string; p_avoid: string[] }> = [];
  const state = { up: true };
  const supabase = {
    rpc: async (_name: string, args: { p_local_date: string; p_avoid: string[] }) => {
      calls.push(args);
      if (!state.up) return { data: null, error: { code: "503", message: "Service Unavailable" } };
      return { data: [{ quote_id: pick(), local_date: args.p_local_date }], error: null };
    },
  };
  return { supabase: supabase as never, calls, state };
}

describe("the day's quote stays the same through a brief outage", () => {
  test("the hunt's sequence: database, outage, database, outage shows the database's quote every time, with its scene", async () => {
    assert.ok(quoteById("con-056") && quoteById("gro-046"), "the hunt's two quotes are in the library");
    const storage = memoryStorage();
    const { supabase, state } = database(() => "con-056");
    const shown: string[] = [];
    const scenes: string[] = [];
    for (const up of [true, false, true, false, false, true]) {
      state.up = up;
      const { quote } = await getDailyQuote(supabase, { userId: USER, localDate: DAY, storage });
      shown.push(quote.id);
      scenes.push(quote.scene);
    }
    assert.deepEqual(new Set(shown), new Set(["con-056"]), `one quote all day (${shown.join(", ")})`);
    assert.equal(new Set(scenes).size, 1, "and one scene");
  });

  test("the database's quote is remembered on the device for its day, marked as the database's", async () => {
    const storage = memoryStorage();
    const { supabase } = database(() => "con-056");
    const result = await getDailyQuote(supabase, { userId: USER, localDate: DAY, storage });
    assert.equal(result.stored, true);
    assert.deepEqual(parseHistory(storage.data.get(historyKey(USER)) ?? null), [{ date: DAY, id: "con-056", stored: true }]);
  });

  test("an outage on the day's first visit shows a local quote; once the database answers, its quote stays for the rest of the day", async () => {
    const storage = memoryStorage();
    const { supabase, calls, state } = database(() => "con-056");
    state.up = false;
    const first = await getDailyQuote(supabase, { userId: USER, localDate: DAY, storage });
    assert.equal(first.stored, false);
    state.up = true;
    const second = await getDailyQuote(supabase, { userId: USER, localDate: DAY, storage });
    assert.equal(second.quote.id, "con-056");
    assert.deepEqual(calls.at(-1)?.p_avoid, [first.quote.id], "the local quote is passed to the database to avoid");
    state.up = false;
    const third = await getDailyQuote(supabase, { userId: USER, localDate: DAY, storage });
    assert.equal(third.quote.id, "con-056", "after that, the database's quote, not the local one again");
    const history = parseHistory(storage.data.get(historyKey(USER)) ?? null);
    assert.deepEqual(history, [{ date: DAY, id: first.quote.id }, { date: DAY, id: "con-056", stored: true }], "the local quote stays as seen");
  });

  test("only quotes this device chose itself are sent to the database to avoid, never the database's own", async () => {
    const storage = memoryStorage({ [historyKey(USER)]: JSON.stringify([{ date: "2026-11-24", id: "dis-001" }, { date: "2026-11-25", id: "dis-062", stored: true }]) });
    const { supabase, calls } = database(() => "con-056");
    await getDailyQuote(supabase, { userId: USER, localDate: DAY, storage });
    assert.deepEqual(calls[0].p_avoid, ["dis-001"]);
    assert.deepEqual(localOnlyQuotes(parseHistory(storage.data.get(historyKey(USER)) ?? null)), ["dis-001"]);
  });

  test("a later day in an outage doesn't repeat a quote the database showed before", async () => {
    const storage = memoryStorage();
    const days = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"];
    const picks = ["con-056", "gro-046", "dis-062", "dis-001", "dis-002", "dis-003"];
    let index = 0;
    const { supabase, state } = database(() => picks[index]);
    for (index = 0; index < days.length; index += 1) await getDailyQuote(supabase, { userId: USER, localDate: days[index], storage });
    state.up = false;
    const offline = await getDailyQuote(supabase, { userId: USER, localDate: DAY, storage });
    assert.ok(!picks.includes(offline.quote.id), `${offline.quote.id} was already shown`);
  });

  test("remembering the same database quote twice keeps one entry", () => {
    const storage = memoryStorage();
    rememberStoredQuote(storage, USER, DAY, "con-056");
    rememberStoredQuote(storage, USER, DAY, "con-056");
    assert.deepEqual(parseHistory(storage.data.get(historyKey(USER)) ?? null), [{ date: DAY, id: "con-056", stored: true }]);
  });

  test("a history saved before this change (no marks) still works", async () => {
    const storage = memoryStorage({ [historyKey(USER)]: JSON.stringify([{ date: DAY, id: "gro-046" }]) });
    const { supabase, state } = database(() => "con-056");
    state.up = false;
    assert.equal((await getDailyQuote(supabase, { userId: USER, localDate: DAY, storage })).quote.id, "gro-046");
  });

  test("blocked storage still shows the database's quote", async () => {
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const { supabase } = database(() => "con-056");
    assert.equal((await getDailyQuote(supabase, { userId: USER, localDate: DAY, storage: throwing })).quote.id, "con-056");
  });
});
