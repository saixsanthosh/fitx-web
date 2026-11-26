// Home's quote area on a stalled connection (release 3 fix round 3f, review
// integration:home-quote-still-loads-forever-on-stalled-connection). Round 3e's 20 s limit on the shared user context
// (5950fbf) made the context give up, but Home then fell back on its own session check and its quote's load, and
// neither had a limit: on a stalled connection, a captive portal or a server that hangs, the quote area kept its two
// loading lines for good. Each of Home's own waits now ends within 20 s. A session check with no answer counts as one
// that failed, with the member this browser's session names (src/components/account/session-state.ts
// checkSessionKeepingMember). A quote with no answer from the database is cancelled, and this device's quote shows
// (src/lib/home/daily-quote.ts getDailyQuote).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AuthClient, AuthRetryableFetchError, createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SESSION_CHECK_TIME_LIMIT_MS, checkSessionKeepingMember, type SessionAuth } from "@/components/account/session-state";
import { USER_CONTEXT_TIME_LIMIT_MS, refreshUserContext, type UserContextStatus } from "@/components/app/user-context-refresh";
import { quoteById } from "@/data/quotes";
import { DAILY_QUOTE_TIME_LIMIT_MS, getDailyQuote, historyKey, localOnlyQuotes, parseHistory } from "@/lib/home/daily-quote";
import { homeMember, needsOwnCheck, quoteArea } from "@/lib/home/quote-area";

const ID = "11111111-1111-4111-8111-111111111111";
const DAY = "2026-11-26";
const never = <T>() => new Promise<T>(() => undefined);
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function turns(count = 5) {
  for (let index = 0; index < count; index += 1) await turn();
}
const signedInSession = async () => ({ data: { session: { user: { id: ID } } } });

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}

/** fitx_daily_quote as supabase-js builds it (a request that takes a signal), never answering. */
function hangingDatabase() {
  const seen: { signal: AbortSignal | null; calls: number } = { signal: null, calls: 0 };
  const supabase = {
    rpc: () => {
      seen.calls += 1;
      const request = {
        abortSignal(signal: AbortSignal) {
          seen.signal = signal;
          return request;
        },
        then<A, B>(onAnswer?: (value: never) => A, onFailure?: (reason: unknown) => B) {
          return never<never>().then(onAnswer, onFailure);
        },
      };
      return request;
    },
  };
  return { supabase: supabase as never, seen };
}

describe("Home's own session check ends within 20 s", () => {
  test("a check with no answer ends at 20 s, not before, as a check that failed, with the member this browser's session names", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const auth: SessionAuth = { getUser: () => never(), getSession: signedInSession };
    let result: unknown = "waiting";
    void checkSessionKeepingMember(auth).then((value) => { result = value; });
    t.mock.timers.tick(SESSION_CHECK_TIME_LIMIT_MS - 1);
    await turns();
    assert.equal(result, "waiting", "still waiting a moment before the limit");
    t.mock.timers.tick(1);
    await turns();
    // Home then shows the day's quote this device keeps for that member (bug 70), never "signed out".
    assert.deepEqual(result, { state: "unknown", userId: ID });
    assert.equal(SESSION_CHECK_TIME_LIMIT_MS, 20_000);
    assert.equal(SESSION_CHECK_TIME_LIMIT_MS, USER_CONTEXT_TIME_LIMIT_MS, "the shared context's limit");
  });

  test("the session read waits beside the check, so even when it hangs too the whole check ends at 20 s, naming nobody", async (t) => {
    // An access token being renewed over the same stalled connection: getSession() can't answer either.
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let result: unknown = "waiting";
    void checkSessionKeepingMember({ getUser: () => never(), getSession: () => never() }).then((value) => { result = value; });
    t.mock.timers.tick(SESSION_CHECK_TIME_LIMIT_MS);
    await turns();
    // Home then says "Today’s quote could not be loaded. It will be here when you come back."
    assert.deepEqual(result, { state: "unknown", userId: null });
  });

  test("answers within the limit are used as before, a slow session read included", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const offline = { data: { user: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) };
    let slowRead: (value: { data: { session: { user: { id: string } } } }) => void = () => undefined;
    let result: unknown = "waiting";
    void checkSessionKeepingMember({
      getUser: async () => offline,
      getSession: () => new Promise((resolve) => { slowRead = resolve; }),
    }).then((value) => { result = value; });
    t.mock.timers.tick(SESSION_CHECK_TIME_LIMIT_MS - 1);
    await turns();
    assert.equal(result, "waiting");
    slowRead({ data: { session: { user: { id: ID } } } });
    await turns();
    assert.deepEqual(result, { state: "unknown", userId: ID }, "a session read that answers in time still names the member");
    t.mock.timers.reset();

    assert.deepEqual(await checkSessionKeepingMember({ getUser: async () => ({ data: { user: { id: ID } }, error: null }), getSession: signedInSession }), { state: "signed_in", userId: ID });
    assert.deepEqual(await checkSessionKeepingMember({ getUser: async () => ({ data: { user: null }, error: null }), getSession: signedInSession }), { state: "signed_out", userId: null }, "the server's answer, never the local session's");
  });

  test("with the real supabase-js auth client and an auth server that never answers: a failed check, with the stored session's member", async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
    const storageKey = "sb-test-auth-token";
    store.set(storageKey, JSON.stringify({ access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: ID } }));
    const asked: string[] = [];
    const stalled = (input: RequestInfo | URL) => {
      asked.push(String(input));
      return never<Response>();
    };
    const auth = new AuthClient({ url: "https://auth.example.test/auth/v1", storage, storageKey, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, fetch: stalled as typeof fetch });
    const started = Date.now();
    assert.deepEqual(await checkSessionKeepingMember(auth, 60), { state: "unknown", userId: ID });
    assert.ok(Date.now() - started < 2_000, "it ends at its limit");
    assert.deepEqual(asked, ["https://auth.example.test/auth/v1/user"], "the hung request was GET /auth/v1/user");
    assert.equal(store.has(storageKey), true, "the session is kept");
  });
});

describe("the quote's load ends within 20 s", () => {
  test("a database that never answers: at 20 s, not before, the request is cancelled and the device's quote for the day shows", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const storage = memoryStorage({ [historyKey(ID)]: JSON.stringify([{ date: DAY, id: "con-056", stored: true }]) });
    const { supabase, seen } = hangingDatabase();
    let result: unknown = "waiting";
    void getDailyQuote(supabase, { userId: ID, localDate: DAY, storage }).then((value) => { result = value; });
    t.mock.timers.tick(DAILY_QUOTE_TIME_LIMIT_MS - 1);
    await turns();
    assert.equal(result, "waiting", "still waiting a moment before the limit");
    assert.equal(seen.signal?.aborted, false);
    t.mock.timers.tick(1);
    await turns();
    assert.deepEqual(result, { quote: quoteById("con-056"), stored: false }, "the database's quote this device kept today (bug 70)");
    assert.equal(seen.calls, 1);
    assert.equal(seen.signal?.aborted, true, "the request is cancelled");
    assert.equal(DAILY_QUOTE_TIME_LIMIT_MS, USER_CONTEXT_TIME_LIMIT_MS, "the shared context's limit");
  });

  test("with no quote for the day on this device yet, it picks one itself, as during an outage, and tells the database next time", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const storage = memoryStorage();
    const { supabase } = hangingDatabase();
    let result: { quote: { id: string }; stored: boolean } | null = null;
    void getDailyQuote(supabase, { userId: ID, localDate: DAY, storage }).then((value) => { result = value; });
    t.mock.timers.tick(DAILY_QUOTE_TIME_LIMIT_MS);
    await turns();
    assert.ok(result, "it answered");
    const picked = (result as { quote: { id: string }; stored: boolean }).quote.id;
    assert.equal((result as { stored: boolean }).stored, false);
    assert.deepEqual(localOnlyQuotes(parseHistory(storage.getItem(historyKey(ID)))), [picked], "kept on the device as its own pick, passed in p_avoid later");
  });

  test("with the real supabase-js client: the quote's request is a POST that carries the signal, and is cancelled at the limit", async () => {
    const seen: { url: string; method: string; signal: AbortSignal | null }[] = [];
    const stalled = (input: RequestInfo | URL, init?: RequestInit) => {
      const signal = (init?.signal ?? null) as AbortSignal | null;
      seen.push({ url: String(input), method: init?.method ?? "GET", signal });
      return new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    };
    const supabase = createSupabaseClient("https://stand-in.supabase.co", "anon", { global: { fetch: stalled as typeof fetch }, auth: { persistSession: false, autoRefreshToken: false } });
    const storage = memoryStorage({ [historyKey(ID)]: JSON.stringify([{ date: DAY, id: "gro-046", stored: true }]) });
    const started = Date.now();
    const result = await getDailyQuote(supabase, { userId: ID, localDate: DAY, storage, ms: 60 });
    assert.ok(Date.now() - started < 2_000, "it ends at its limit");
    assert.deepEqual(result, { quote: quoteById("gro-046"), stored: false });
    await turn();
    assert.equal(seen.length, 1, "one request, never sent again");
    assert.equal(seen[0].url, "https://stand-in.supabase.co/rest/v1/rpc/fitx_daily_quote");
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].signal?.aborted, true, "the request was cancelled");
  });
});

describe("the whole quote area on a connection where every request hangs", () => {
  /** The shared context's refresh with its own limit (shell's), as Home reads it once that has run out. */
  async function contextAfterItsLimit(auth: SessionAuth) {
    const state: { status: UserContextStatus; userId: string | null } = { status: "loading", userId: null };
    void refreshUserContext({ auth } as never, () => true, {
      setStatus: (next) => { state.status = typeof next === "function" ? next(state.status) : next; },
      setData: (data) => { state.userId = data?.userId ?? null; },
      setFailedPart: () => undefined,
    }, { ms: 20 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    return state;
  }

  test("the loading lines give way to the device's quote once Home's own waits end", async () => {
    const auth: SessionAuth = { getUser: () => never(), getSession: signedInSession };
    const shared = await contextAfterItsLimit(auth);
    assert.deepEqual(shared, { status: "error", userId: null }, "the context gave up (round 3e)");
    assert.equal(needsOwnCheck(shared), true, "so Home checks the session itself");
    assert.equal(quoteArea(homeMember(shared, null), "loading"), "loading", "while that check waits");

    const own = await checkSessionKeepingMember(auth, 20);
    const member = homeMember(shared, own);
    assert.deepEqual(member, { kind: "member", userId: ID }, "a check that failed keeps the session's member");

    const storage = memoryStorage({ [historyKey(ID)]: JSON.stringify([{ date: DAY, id: "con-056", stored: true }]) });
    const { quote } = await getDailyQuote(hangingDatabase().supabase, { userId: ID, localDate: DAY, storage, ms: 20 });
    assert.equal(quote.id, "con-056", "the day's quote this device kept");
    // Once getDailyQuote has answered, DailyHome's quote is "shown".
    assert.equal(quoteArea(member, "shown"), "quote", "today's quote, never loading for good");
  });

  test("with no member this browser's session names, the area says the quote could not be loaded, never loading for good", async () => {
    const auth: SessionAuth = { getUser: () => never(), getSession: () => never() };
    const shared = await contextAfterItsLimit(auth);
    const own = await checkSessionKeepingMember(auth, 20);
    assert.deepEqual(own, { state: "unknown", userId: null });
    assert.equal(quoteArea(homeMember(shared, own), "loading"), "unavailable", "Today’s quote could not be loaded. It will be here when you come back.");
  });
});

describe("DailyHome waits through them", () => {
  const home = readFileSync(new URL("../../src/components/home/DailyHome.tsx", import.meta.url), "utf8");

  test("its own check and the quote's load are the limited ones, with their default 20 s", () => {
    assert.match(home, /void checkSessionKeepingMember\(supabase\?\.auth \?\? null\)\.then\(\(result\) => \{\s*if \(live\) setOwn\(result\);\s*\}\);/);
    assert.match(home, /void getDailyQuote\(createClient\(\), \{ userId, localDate: today \}\)\s*\.then\(\(result\) => \{ if \(live\) setLoaded\(\{ key, quote: result\.quote \}\); \}\)/);
    assert.doesNotMatch(home, /auth\.getUser\(|\.rpc\(/, "no other request of its own without a limit");
  });

  test("a session that a late answer finds ended still says so: auth's SIGNED_OUT event", () => {
    assert.match(home, /if \(event === "SIGNED_OUT" && live\) setOwn\(\{ state: "signed_out", userId: null \}\);/);
  });

  test("the limits sit in the shared helpers, so nothing waits without one", () => {
    const session = readFileSync(new URL("../../src/components/account/session-state.ts", import.meta.url), "utf8");
    const keeping = session.slice(session.indexOf("export async function checkSessionKeepingMember"), session.indexOf("export function sharedStatusWithoutUser"));
    assert.match(keeping, /checkSession\(\(\) => withTimeLimit\(auth\.getUser\(\), ms\)\)/);
    assert.match(keeping, /await withTimeLimit\(auth\.getSession\(\), ms\)/);
    assert.doesNotMatch(keeping.replace(/withTimeLimit\(auth\.(?:getUser|getSession)\(\), ms\)/g, ""), /auth\.(?:getUser|getSession)\(\)/, "every auth call is limited");
    const quote = readFileSync(new URL("../../src/lib/home/daily-quote.ts", import.meta.url), "utf8");
    assert.match(quote, /await withTimeLimit\(withAbortSignal\(supabase, controller\.signal\)\.rpc\("fitx_daily_quote", /);
    assert.match(quote, /if \(isTimeLimit\(problem\)\) controller\.abort\(\);/);
  });
});
