// The quote of the day in the browser (src/lib/home/daily-quote.ts): the pure pick, the localStorage history used
// before the migration, and how getDailyQuote uses the database function when it is there.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { QUOTES, type Quote } from "@/data/quotes";
import { getDailyQuote, hashKey, historyKey, localDailyQuote, parseHistory, pickQuote, quoteFromRow, seenInOrder } from "@/lib/home/daily-quote";

const USER = "11111111-2222-4333-8444-555555555555";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}

const nextDay = (key: string, offset: number) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

describe("pickQuote", () => {
  test("is deterministic for a member and a day, and differs between members", () => {
    const first = pickQuote(new Set(), "2026-11-23", USER);
    assert.equal(pickQuote(new Set(), "2026-11-23", USER), first);
    const others = new Set(["a", "b", "c", "d", "e"].map((who) => pickQuote(new Set(), "2026-11-23", who).id));
    assert.ok(others.size > 1, "different members do not all get the same quote");
  });

  test("never repeats a seen quote while unseen ones remain: a whole year of different quotes", () => {
    const seen = new Set<string>();
    let day = "2026-01-01";
    for (let index = 0; index < QUOTES.length; index += 1) {
      const quote = pickQuote(seen, day, USER);
      assert.ok(!seen.has(quote.id), `day ${index + 1} repeated ${quote.id}`);
      seen.add(quote.id);
      day = nextDay(day, 1);
    }
    assert.equal(seen.size, QUOTES.length);
  });

  test("once everything has been seen, the oldest seen comes back first", () => {
    const order = [...QUOTES].reverse().map((quote) => quote.id);
    assert.equal(pickQuote(new Set(order), "2027-06-01", USER).id, order[0]);
  });

  test("the hash is a stable 32-bit number", () => {
    assert.equal(hashKey("fitx"), hashKey("fitx"));
    assert.ok(hashKey("fitx") >= 0 && hashKey("fitx") < 2 ** 32);
    assert.notEqual(hashKey("a"), hashKey("b"));
  });
});

describe("the browser's history (before the migration)", () => {
  test("the same quote all day, saved per member; a new one the next day", () => {
    const storage = memoryStorage();
    const today = localDailyQuote(storage, USER, "2026-11-23");
    assert.equal(localDailyQuote(storage, USER, "2026-11-23"), today, "a reload shows the same quote");
    const tomorrow = localDailyQuote(storage, USER, "2026-11-24");
    assert.notEqual(tomorrow.id, today.id);
    assert.deepEqual(parseHistory(storage.data.get(historyKey(USER)) ?? null), [{ date: "2026-11-23", id: today.id }, { date: "2026-11-24", id: tomorrow.id }]);
    assert.notEqual(localDailyQuote(storage, "someone-else", "2026-11-23"), undefined);
    assert.ok(storage.data.has(historyKey("someone-else")), "each member has their own history");
  });

  test("bad or blocked storage still gives a quote", () => {
    assert.ok(localDailyQuote(memoryStorage({ [historyKey(USER)]: "{not json" }), USER, "2026-11-23").text);
    assert.ok(localDailyQuote(null, USER, "2026-11-23").text);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    assert.ok(localDailyQuote(throwing, USER, "2026-11-23").text);
  });

  test("history is read oldest first, malformed entries dropped, a re-shown quote counted at its newest day", () => {
    const entries = parseHistory(JSON.stringify([{ date: "2026-02-02", id: "b" }, { date: "nope", id: "x" }, null, { date: "2026-01-01", id: "a" }, { date: "2026-03-03", id: "a" }]));
    assert.deepEqual(entries.map((entry) => entry.id), ["a", "b", "a"]);
    assert.deepEqual([...seenInOrder(entries)], ["b", "a"]);
  });
});

describe("getDailyQuote", () => {
  test("uses the database's pick and passes this browser's earlier quotes to avoid", async () => {
    const storage = memoryStorage({ [historyKey(USER)]: JSON.stringify([{ date: "2026-11-20", id: "dis-001" }]) });
    const calls: unknown[] = [];
    const supabase = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: [{ quote_id: "min-004" }], error: null }; } };
    const result = await getDailyQuote(supabase as never, { userId: USER, localDate: "2026-11-23", storage });
    assert.equal(result.stored, true);
    assert.equal(result.quote.id, "min-004");
    assert.deepEqual(calls, [["fitx_daily_quote", { p_local_date: "2026-11-23", p_avoid: ["dis-001"] }]]);
  });

  test("before the migration (no function) it falls back to the browser's history", async () => {
    const storage = memoryStorage();
    const supabase = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) };
    const result = await getDailyQuote(supabase as never, { userId: USER, localDate: "2026-11-23", storage });
    assert.equal(result.stored, false);
    assert.equal(result.quote, localDailyQuote(storage, USER, "2026-11-23"));
  });

  test("offline, or without a database, it still shows the day's quote", async () => {
    const supabase = { rpc: async () => { throw new TypeError("Failed to fetch"); } };
    assert.equal((await getDailyQuote(supabase as never, { userId: USER, localDate: "2026-11-23", storage: memoryStorage() })).stored, false);
    assert.equal((await getDailyQuote(null, { userId: USER, localDate: "2026-11-23", storage: memoryStorage() })).stored, false);
  });

  test("a quote the database knows but this build does not is shown from its row", () => {
    const row = { quote_id: "new-001", text: "Brand new line.", author: null, source: null, theme: "growth", scene: "ridge-sunrise" };
    assert.deepEqual(quoteFromRow(row), { id: "new-001", text: "Brand new line.", author: null, source: null, theme: "growth", scene: "ridge-sunrise" } satisfies Quote);
    assert.equal(quoteFromRow({ quote_id: "new-002" }), null);
    assert.equal(quoteFromRow(null), null);
  });
});
