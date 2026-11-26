// Open item from fix round 3a (open-3a-onboarding-save-timeout): setup's saves had no time limit, unlike sign-in's. A
// save that never answered (a stalled connection, a captive portal, a server that hangs) left Continue on "Saving…"
// until the page was reloaded, with nothing said. Now a step's save stops at its limit (sign-in's withTimeLimit),
// cancels the requests it still has on their way, and says in setup's words that it stopped and to try again. Every
// answer stays as typed, and keyboard focus stays where the member left it (D5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadBirthDate, logWeighIn, savePreferences, updateProfileRow } from "@/lib/domain/user-context";
import { SAVE_FAILED, SAVE_TIMED_OUT, SETUP_TIME_LIMIT_MS, saveWithinLimit, withAbortSignal } from "@/lib/onboarding/time-limit";

const flow = readFileSync(new URL("../../src/app/(auth)/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");
const never = () => new Promise<never>(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));

/** A function's body in the flow, from its declaration to the closing brace at its own indent. */
function body(name: string): string {
  const found = new RegExp(`\\n([ \\t]*)(?:async )?function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\1\\}`).exec(flow);
  assert.ok(found, `${name}() was found`);
  return found[2];
}

type Request = { table: string; method: string; signal?: AbortSignal };

/** A request being built: its filters chain, `abortSignal()` keeps the signal, and awaiting it gives the answer. */
interface Chain {
  eq(...args: unknown[]): Chain;
  not(...args: unknown[]): Chain;
  order(...args: unknown[]): Chain;
  limit(...args: unknown[]): Chain;
  select(...args: unknown[]): Chain;
  maybeSingle(): Chain;
  abortSignal(signal: AbortSignal): Chain;
  then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown): Promise<unknown>;
}

/** What `from(table)` gives: each of these starts a request. */
interface Query {
  select(...args: unknown[]): Chain;
  insert(...args: unknown[]): Chain;
  update(...args: unknown[]): Chain;
  upsert(...args: unknown[]): Chain;
  delete(...args: unknown[]): Chain;
}

/**
 * A stand-in for the Supabase client with the shape the shared helpers use: `from(table)` and `rpc()` start a request,
 * and awaiting it gives `answer(request, count)`, `count` being how many requests have started.
 */
function database(answer: (request: Request, count: number) => unknown = () => ({ data: [{ id: "member" }], error: null })) {
  const requests: Request[] = [];
  const start = (request: Request): Chain => {
    requests.push(request);
    const count = requests.length;
    const chain: Chain = {
      eq: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      select: () => chain,
      maybeSingle: () => chain,
      abortSignal: (signal) => {
        request.signal = signal;
        return chain;
      },
      then: (resolve, reject) => Promise.resolve(answer(request, count)).then(resolve, reject),
    };
    return chain;
  };
  const client = {
    auth: { getUser: () => "the client's own" },
    from: (table: string): Query => ({
      select: () => start({ table, method: "select" }),
      insert: () => start({ table, method: "insert" }),
      update: () => start({ table, method: "update" }),
      upsert: () => start({ table, method: "upsert" }),
      delete: () => start({ table, method: "delete" }),
    }),
    rpc: (name: string) => start({ table: name, method: "rpc" }),
  };
  return { client, requests };
}

/** What Supabase's client answers once a request's signal is aborted (it answers, it does not throw). */
const ABORTED = { data: null, error: { message: "AbortError: signal is aborted without reason", code: "" } };
const untilAborted = (request: Request) => new Promise((resolve) => request.signal?.addEventListener("abort", () => resolve(ABORTED), { once: true }));

test("a save that never answers stops at its limit, not before, and cancels what it still has on its way", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  let settled = false;
  const shown = saveWithinLimit((given) => {
    signal = given;
    return never();
  });
  void shown.then(() => { settled = true; });
  t.mock.timers.tick(SETUP_TIME_LIMIT_MS.save - 1);
  await turn();
  assert.equal(settled, false, "still waiting a moment before the limit");
  assert.equal(signal?.aborted, false, "its requests are left alone until then");
  t.mock.timers.tick(1);
  assert.equal(await shown, SAVE_TIMED_OUT.page, "Saving… ends with setup's message");
  assert.equal(signal?.aborted, true, "the save's requests are cancelled");

  const finishing = saveWithinLimit(() => never(), { finishing: true });
  t.mock.timers.tick(SETUP_TIME_LIMIT_MS.save);
  assert.equal(await finishing, SAVE_TIMED_OUT.finish, "the last step says Finishing setup, as its button does");
});

test("a save that answers in time gives its own outcome, and nothing is cancelled", async () => {
  let signal: AbortSignal | undefined;
  assert.equal(await saveWithinLimit(async (given) => { signal = given; return null; }), null, "saved: setup moves on");
  assert.equal(signal?.aborted, false);
  const refused = "One of these answers isn't accepted yet. Choose another for now.";
  assert.equal(await saveWithinLimit(async () => refused), refused, "the database's refusal keeps its own message");
  // A save that breaks off (a request that throws) says so too, instead of leaving "Saving…" up for good.
  assert.equal(await saveWithinLimit(async () => { throw new Error("broke off"); }), SAVE_FAILED.page);
  assert.equal(await saveWithinLimit(() => { throw new Error("broke off at once"); }, { finishing: true }), SAVE_FAILED.finish);
});

test("the messages say what happened and what to do, in setup's plain words", () => {
  assert.equal(SETUP_TIME_LIMIT_MS.save, 20_000, "sign-in's limit for a check, for a whole step's few requests");
  for (const [name, message] of Object.entries(SAVE_TIMED_OUT)) {
    assert.match(message, / is taking too long, so we stopped waiting\. Check your connection and try again\.$/, `${name}: what happened, and what to do`);
    assert.doesNotMatch(message, /error|fail|timeout|timed out|request/i, `${name} is in plain words`);
    assert.ok(message.length < 110, `${name} is short`);
  }
  assert.match(SAVE_TIMED_OUT.page, /^Saving this page /, "as the step's other messages say: this page");
  assert.match(SAVE_TIMED_OUT.finish, /^Finishing setup /);
  assert.equal(SAVE_FAILED.page, "We couldn't save this page. Check your connection and try again.", "setup's own message, unchanged");
  assert.equal(SAVE_FAILED.finish, "We couldn't finish setting up your account. Please try again.");
});

test("every request a step's save makes carries its signal, the shared helpers' too", async () => {
  const { client, requests } = database((request) => (request.method === "select" ? { data: { date_of_birth: "1990-02-28" }, error: null } : { data: [{ id: "member" }], error: null }));
  const signal = new AbortController().signal;
  const db = withAbortSignal(client, signal);
  assert.equal(db.auth, client.auth, "everything else is the client itself");
  assert.equal(db.auth.getUser(), "the client's own");
  assert.deepEqual(await updateProfileRow(db as never, "member", { name: "Asha" }), { error: null });
  assert.equal(await loadBirthDate(db as never, "member"), "1990-02-28");
  assert.equal((await savePreferences(db as never, "member", { timezone: "Asia/Kolkata" }, { v2: true, v3: true })).error, null);
  assert.deepEqual(await logWeighIn(db as never, "member", 68.04, "Starting weight"), { error: null, synced: true });
  await db.from("body_metrics").select("weight").eq("user_id", "member").maybeSingle();
  await db.from("profiles").delete().eq("id", "member");
  assert.deepEqual(requests.map(({ method, table }) => `${method} ${table}`), [
    "update profiles",
    "select profiles",
    "upsert user_preferences",
    "insert body_metrics",
    "update profiles",
    "select body_metrics",
    "delete profiles",
  ]);
  for (const request of requests) assert.equal(request.signal, signal, `${request.method} ${request.table}`);
});

test("a profile row created on the way is created and saved with the signal too", async () => {
  // The first update finds no row (an account whose row is missing): the helper creates it, then updates again.
  const { client, requests } = database((request, count) => (count === 1 ? { data: [], error: null } : request.method === "rpc" ? { data: null, error: null } : { data: [{ id: "member" }], error: null }));
  const signal = new AbortController().signal;
  assert.deepEqual(await updateProfileRow(withAbortSignal(client, signal) as never, "member", { height: 162.5 }), { error: null });
  assert.deepEqual(requests.map(({ method, table }) => `${method} ${table}`), ["update profiles", "rpc fitx_ensure_profile", "update profiles"]);
  for (const request of requests) assert.equal(request.signal, signal, `${request.method} ${request.table}`);
});

test("at the limit the save's request answers at once and nothing more is sent, so none of it lands after the next try", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { client, requests } = database(untilAborted);
  let woundDown = false;
  const shown = saveWithinLimit(async (signal) => {
    const db = withAbortSignal(client, signal);
    const saved = await updateProfileRow(db as never, "member", { name: "Asha" });
    // What a page does next after a failed write: it stops (savePage returns its message).
    woundDown = true;
    return saved.error ? SAVE_FAILED.page : null;
  });
  t.mock.timers.tick(SETUP_TIME_LIMIT_MS.save);
  assert.equal(await shown, SAVE_TIMED_OUT.page, "what the member sees is the time limit's message, not the late one");
  await turn();
  assert.equal(woundDown, true, "the cancelled request answered straight away");
  assert.deepEqual(requests.map(({ method, table }) => `${method} ${table}`), ["update profiles"], "and no other request was started");
});

test("setup's steps save within the limit, with every request built from the save's signal", () => {
  const advance = body("advance");
  assert.match(advance, /const problem = await saveWithinLimit\(async \(signal\) => \(await savePage\(page, form, signal\)\) \?\? \(isLast \? await finish\(form, signal\) : null\), \{ finishing: isLast \}\);/);
  const wrapped = "const supabase = withAbortSignal(client, signal);";
  for (const name of ["savePage", "finish"]) {
    const save = body(name);
    assert.match(save, /^\s*const client = createClient\(\);\s*if \(!client \|\| !context\) return "Your session has ended\. Sign in again to continue\.";\s*(?:\/\/[^\n]*\n\s*)*const supabase = withAbortSignal\(client, signal\);/, `${name} builds its requests with the signal`);
    assert.doesNotMatch(save.slice(save.indexOf(wrapped) + wrapped.length), /\bclient\b|createClient\(/, `${name} sends nothing without it`);
  }
  assert.match(flow, /async function savePage\(current: OnboardingPage, values: OnboardingForm, signal: AbortSignal\) \{/);
  assert.match(flow, /async function finish\(values: OnboardingForm, signal: AbortSignal\) \{/);
  assert.match(body("finish"), /if \(done\.error\) return SAVE_FAILED\.finish;/);
  assert.match(body("savePage"), /: SAVE_FAILED\.page;/);
});

test("when a save stops, Saving… ends, the answers stay as typed and focus is looked after as for any failed save", () => {
  const advance = body("advance");
  const failed = /if \(problem\) \{([\s\S]*?)\n\s*\}/.exec(advance)?.[1] ?? "";
  assert.match(failed, /^\s*setSaving\(false\);\s*setSaveError\(problem\);\s*setFailedSaves\(\(count\) => count \+ 1\);\s*return;\s*$/, "the message beside the buttons, and the focus check");
  assert.doesNotMatch(advance, /setForm|setDrafts|setPageIndex\(0\)|setReload/, "nothing typed is put back or reloaded");
  // Continue stays focusable while it saves, so focus is still on it when the message comes (save-focus.test.ts).
  assert.match(flow, /<button ref=\{submitRef\} type="submit" aria-disabled=\{saving \|\| undefined\}/);
  assert.match(flow, /\{saving \? "Saving…" : isLast \? "Finish setup" : "Continue"\}/);
});
