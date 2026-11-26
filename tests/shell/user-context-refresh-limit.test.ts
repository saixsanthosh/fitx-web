// Fix round 3e (open-3d-usercontext-refresh-limit): the shared user context's refresh (UserContextProvider) had no time
// limit. Its session check and its load (loadUserContext) waited for good on a request that never answered, so the
// context said "loading" for good: Home's quote area kept its loading bars and Explore's setup form stayed a skeleton
// (Profile stopped waiting on its own since round 3d). Now the context waits 20 s for a refresh's answers. Past that, a
// context that has shown nothing yet says what a failed load says ("error"), and one that shows an answer keeps it.
// Nothing is cancelled and the ticket stays, so a late answer still lands. Answers within 20 s are used as before.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  USER_CONTEXT_TIME_LIMIT_MS,
  refreshUserContext,
  statusPastLimit,
  type UserContextSetters,
  type UserContextStatus,
} from "@/components/app/user-context-refresh";
import { preferSharedAccount } from "@/components/layout/accountSummary";
import { onboardedFrom } from "@/components/layout/setup-mode";
import { PROFILE_TIME_LIMIT_MS, SAVED_NOT_SHOWN, noticeAfterReload, statusAfterWait, waitWithin } from "@/components/profile/profile-save";
import type { LoadPart, LoadResult, UserContextData } from "@/lib/domain/user-context";
import { homeMember, needsOwnCheck } from "@/lib/home/quote-area";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.test" };
const never = () => new Promise<never>(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));

/** A gate a stand-in request waits behind: `open()` lets its answer through. */
function gate() {
  let open: () => void = () => undefined;
  const passed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { passed, open };
}

type AuthAnswer = { data: { user: typeof USER | null }; error: unknown };

/**
 * A stand-in Supabase client for one member, with the shape loadUserContext reads through. The session check
 * (auth.getUser) answers `auth` once `check` has passed, and each of the load's reads answers once `reads` has passed.
 * Pass never() to make either hang.
 */
function memberClient({
  check = Promise.resolve(),
  reads = Promise.resolve(),
  name = "Asha Rao",
  auth = { data: { user: USER }, error: null },
}: { check?: Promise<unknown>; reads?: Promise<unknown>; name?: string; auth?: AuthAnswer } = {}) {
  const requests: string[] = [];
  const answers: Record<string, unknown> = {
    profiles: { data: { name, onboarded: true }, error: null },
    user_preferences: { data: null, error: null },
    body_metrics: { data: null, error: null },
    user_equipment_profiles: { data: [], error: null },
  };
  const read = (table: string) => {
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => reads.then(() => answers[table]).then(resolve, reject),
    };
    for (const method of ["select", "eq", "not", "order", "limit", "maybeSingle"]) builder[method] = () => builder;
    return builder;
  };
  const client = {
    auth: {
      getUser: () => {
        requests.push("auth.getUser");
        return check.then(() => auth);
      },
    },
    from: (table: string) => {
      requests.push(table);
      return read(table);
    },
  };
  return { client: client as unknown as SupabaseClient, requests };
}

/**
 * The provider's state, with React's setter rules (a function gets the current value), and each change of status in
 * order (setting the same status again changes nothing, as in React).
 */
function store(status: UserContextStatus = "loading", data: UserContextData | null = null) {
  const state = { status, data, failedPart: null as LoadPart | null, statuses: [] as UserContextStatus[], loaded: [] as string[] };
  const set: UserContextSetters = {
    setStatus: (update) => {
      const next = typeof update === "function" ? update(state.status) : update;
      if (next !== state.status) state.statuses.push(next);
      state.status = next;
    },
    setData: (value) => {
      state.data = value;
    },
    setFailedPart: (part) => {
      state.failedPart = part;
    },
    loaded: (value) => {
      state.loaded.push(value.userId);
    },
  };
  return { state, set };
}

/** Whether a promise has settled yet (handled either way, so a rejection is never left unhandled). */
function track(promise: Promise<unknown>) {
  const seen = { settled: false, rejected: false };
  promise.then(
    () => {
      seen.settled = true;
    },
    () => {
      seen.settled = true;
      seen.rejected = true;
    },
  );
  return seen;
}

describe("the shared user context's refresh waits 20 s at most", () => {
  test("the limit is 20 s, like setup's and Profile's loads", () => {
    assert.equal(USER_CONTEXT_TIME_LIMIT_MS, 20_000);
    assert.equal(USER_CONTEXT_TIME_LIMIT_MS, PROFILE_TIME_LIMIT_MS.reload);
  });

  test("past the limit, a context still loading says its load failed; one that shows an answer keeps it", () => {
    assert.equal(statusPastLimit("loading"), "error");
    for (const status of ["ready", "signed_out", "error", "unavailable"] as const) assert.equal(statusPastLimit(status), status);
    // The same rule as Profile's own wait for the shared load (round 3d).
    for (const status of ["loading", "ready", "signed_out", "error", "unavailable"] as const) {
      assert.equal(statusPastLimit(status), statusAfterWait(status, true));
    }
  });

  test("answers within 20 s are used as before, and the limit then changes nothing", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    // The member's context: ready, with the profile, and the provider's follow-up (whose it is, the weight sync).
    const member = memberClient();
    const loaded = store();
    await refreshUserContext(member.client, () => true, loaded.set);
    assert.equal(loaded.state.status, "ready");
    assert.equal(loaded.state.data?.userId, USER.id);
    assert.equal(loaded.state.data?.profile?.name, "Asha Rao");
    assert.equal(loaded.state.failedPart, null);
    assert.deepEqual(loaded.state.loaded, [USER.id]);
    assert.deepEqual([...member.requests].sort(), ["auth.getUser", "body_metrics", "profiles", "user_equipment_profiles", "user_preferences"]);

    // A read that failed: "error", naming it.
    const refused = store();
    const failedRead = async (): Promise<LoadResult> => ({ data: null, error: { part: "preferences", cause: { message: "permission denied" } } });
    await refreshUserContext(memberClient().client, () => true, refused.set, { load: failedRead });
    assert.equal(refused.state.status, "error");
    assert.equal(refused.state.failedPart, "preferences");

    // Bug 41's statuses: an ended session is "signed_out"; a check that failed (offline) is "error", never a sign-out.
    const ended = store();
    await refreshUserContext(memberClient({ auth: { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } } }).client, () => true, ended.set);
    assert.equal(ended.state.status, "signed_out");
    const offline = store();
    await refreshUserContext(memberClient({ auth: { data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0 } } }).client, () => true, offline.set);
    assert.equal(offline.state.status, "error");
    assert.equal(offline.state.failedPart, null);

    t.mock.timers.tick(USER_CONTEXT_TIME_LIMIT_MS);
    await turn();
    assert.deepEqual(loaded.state.statuses, ["ready"]);
    assert.deepEqual(refused.state.statuses, ["error"]);
    assert.deepEqual(ended.state.statuses, ["signed_out"]);
    assert.deepEqual(offline.state.statuses, ["error"]);
  });

  test("a session check that never answers: loading for 20 s, then what a failed load shows; nothing is cancelled", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const member = memberClient({ check: never() });
    const { state, set } = store();
    const refresh = track(refreshUserContext(member.client, () => true, set));
    await turn();
    t.mock.timers.tick(USER_CONTEXT_TIME_LIMIT_MS - 1);
    await turn();
    assert.equal(state.status, "loading");
    t.mock.timers.tick(1);
    await turn();
    assert.equal(state.status, "error");
    assert.equal(state.failedPart, null, "no read is named: none answered");
    assert.equal(state.data, null);
    assert.deepEqual(member.requests, ["auth.getUser"]);
    // The refresh settles only with its answer, so a caller with a limit of its own (Profile's reload) still learns
    // that the profile didn't reload.
    assert.equal(refresh.settled, false);
  });

  test("loadUserContext's reads that never answer: the same at 20 s", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const member = memberClient({ reads: never() });
    const { state, set } = store();
    const refresh = track(refreshUserContext(member.client, () => true, set));
    await turn();
    assert.deepEqual([...member.requests].sort(), ["auth.getUser", "body_metrics", "profiles", "user_equipment_profiles", "user_preferences"]);
    t.mock.timers.tick(USER_CONTEXT_TIME_LIMIT_MS - 1);
    await turn();
    assert.equal(state.status, "loading");
    t.mock.timers.tick(1);
    await turn();
    assert.equal(state.status, "error");
    assert.equal(state.data, null);
    assert.equal(refresh.settled, false);
  });

  test("a late answer still lands: the check that answers at 25 s sets ready, with the profile", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const check = gate();
    const member = memberClient({ check: check.passed });
    const { state, set } = store();
    const refresh = track(refreshUserContext(member.client, () => true, set));
    await turn();
    t.mock.timers.tick(USER_CONTEXT_TIME_LIMIT_MS);
    await turn();
    assert.equal(state.status, "error");
    t.mock.timers.tick(5_000);
    check.open();
    await turn();
    assert.equal(state.status, "ready");
    assert.equal(state.data?.profile?.name, "Asha Rao");
    assert.equal(state.failedPart, null);
    assert.deepEqual(state.loaded, [USER.id], "the provider notes whose it is and syncs the weight for a late load too");
    assert.deepEqual(state.statuses, ["error", "ready"]);
    assert.equal(refresh.settled, true);
    assert.equal(refresh.rejected, false);
  });

  test("a late load lands the same way", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const reads = gate();
    const { state, set } = store();
    track(refreshUserContext(memberClient({ reads: reads.passed }).client, () => true, set));
    await turn();
    t.mock.timers.tick(USER_CONTEXT_TIME_LIMIT_MS);
    await turn();
    assert.equal(state.status, "error");
    reads.open();
    await turn();
    assert.equal(state.status, "ready");
    assert.equal(state.data?.userId, USER.id);
  });

  test("a late answer that a sign-out or a newer refresh replaced sets nothing", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    // The provider's ticket: a new refresh and a sign-out each move it on; the limit never does.
    let ticket = 0;
    const start = (client: SupabaseClient, set: UserContextSetters) => {
      const mine = ++ticket;
      return refreshUserContext(client, () => mine === ticket, set);
    };

    // Signed out (in another tab, say) while the first load hangs: it stays signed out.
    const first = gate();
    const signedOut = store();
    void start(memberClient({ check: first.passed }).client, signedOut.set);
    await turn();
    t.mock.timers.tick(10_000);
    ticket += 1;
    signedOut.set.setData(null);
    signedOut.set.setStatus("signed_out");
    t.mock.timers.tick(10_000);
    await turn();
    assert.equal(signedOut.state.status, "signed_out", "past the limit an answer that is shown stays");
    first.open();
    await turn();
    assert.equal(signedOut.state.status, "signed_out");
    assert.equal(signedOut.state.data, null);
    assert.deepEqual(signedOut.state.loaded, []);

    // A newer refresh answered first: the older, late answer doesn't put its older profile back.
    const older = gate();
    const replaced = store();
    void start(memberClient({ check: older.passed, name: "Old name" }).client, replaced.set);
    await turn();
    await start(memberClient({ name: "New name" }).client, replaced.set);
    assert.equal(replaced.state.data?.profile?.name, "New name");
    t.mock.timers.tick(USER_CONTEXT_TIME_LIMIT_MS);
    older.open();
    await turn();
    assert.equal(replaced.state.status, "ready");
    assert.equal(replaced.state.data?.profile?.name, "New name");
    assert.deepEqual(replaced.state.statuses, ["ready"]);
  });

  test("a context that shows the profile keeps it past the limit, so Profile still says a slow save's change isn't shown yet", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { state, set } = store();
    await refreshUserContext(memberClient().client, () => true, set);
    assert.equal(state.status, "ready");

    // Profile's reload after a save (and its Try again) is the provider's refresh inside Profile's own 20 s wait
    // (profile-save.ts waitWithin; round 3d). The reload's check hangs.
    const reloaded = waitWithin(() => refreshUserContext(memberClient({ check: never(), name: "Changed" }).client, () => true, set));
    await turn();
    t.mock.timers.tick(PROFILE_TIME_LIMIT_MS.reload);
    await turn();
    assert.equal(await reloaded, false, "the refresh didn't answer, whichever limit fires first");
    assert.deepEqual(noticeAfterReload({ tone: "saved", text: "Saved" }, false), SAVED_NOT_SHOWN);
    assert.equal(state.status, "ready", "the profile stays on screen, as round 3d's re-check expects");
    assert.equal(state.data?.profile?.name, "Asha Rao");
    assert.deepEqual(state.statuses, ["ready"]);
  });

  test("a refresh that breaks off says its load failed at once, and still rejects as before", async () => {
    const broken = async (): Promise<never> => {
      throw new Error("broke off");
    };
    const first = store();
    await assert.rejects(refreshUserContext(memberClient().client, () => true, first.set, { load: broken }), /broke off/);
    await turn();
    assert.equal(first.state.status, "error");
    assert.equal(first.state.failedPart, null);

    const shown = store();
    await refreshUserContext(memberClient().client, () => true, shown.set);
    await assert.rejects(refreshUserContext(memberClient().client, () => true, shown.set, { load: broken }), /broke off/);
    await turn();
    assert.equal(shown.state.status, "ready");
    assert.equal(shown.state.data?.profile?.name, "Asha Rao");
  });

  test("past the limit, each reader shows what it shows for a failed load, where it waited for good before", () => {
    const loading = { status: "loading" as UserContextStatus, userId: null };
    const failed = { status: statusPastLimit("loading"), userId: null };
    const own = { state: "signed_in" as const, userId: USER.id };
    // Home: while the context loads it waits for it; once the load has failed it asks the session itself (quote-area.ts),
    // so the day's quote loads, or the area says it couldn't be loaded.
    assert.equal(needsOwnCheck(loading), false);
    assert.deepEqual(homeMember(loading, own), { kind: "waiting" });
    assert.equal(needsOwnCheck(failed), true);
    assert.deepEqual(homeMember(failed, own), { kind: "member", userId: USER.id });
    // The header and the sidebar: their own fetch, as while loading (only an ended session names no one).
    const fetched = { name: "Asha", email: USER.email, avatarUrl: null };
    assert.equal(preferSharedAccount(fetched, { status: failed.status, data: null, avatarUrl: null }), fetched);
    assert.equal(preferSharedAccount(fetched, { status: "loading", data: null, avatarUrl: null }), fetched);
    // Help during setup: the link it came by decides, as while loading.
    assert.equal(onboardedFrom({ status: failed.status, data: null }), null);
    // Profile: its alert with Try again, as after its own 20 s.
    assert.equal(statusAfterWait(failed.status, false), "error");
  });
});

describe("UserContextProvider's refresh goes through the limit", () => {
  const provider = readFileSync(new URL("../../src/components/app/UserContextProvider.tsx", import.meta.url), "utf8");
  const refreshModule = readFileSync(new URL("../../src/components/app/user-context-refresh.ts", import.meta.url), "utf8");
  const refresh = provider.slice(provider.indexOf("const refresh = useCallback("), provider.indexOf("useEffect(() => {"));

  test("the provider's refresh runs refreshUserContext with its ticket and React's setters", () => {
    assert.match(provider, /import \{ refreshUserContext, type UserContextStatus \} from "@\/components\/app\/user-context-refresh";/);
    assert.match(provider, /export type \{ UserContextStatus \};/, "quote-area.ts and the readers still import the type from the provider");
    assert.match(refresh, /const ticket = \+\+request\.current;\s*(?:\/\/[^\n]*\n\s*)*await refreshUserContext\(supabase, \(\) => ticket === request\.current, \{\s*setStatus,\s*setData,\s*setFailedPart,\s*loaded: \(loaded\) => \{\s*loadedUser\.current = loaded\.userId;/);
    assert.match(refresh, /void syncProfileWeight\(supabase, loaded\.userId, latest\);/);
    assert.doesNotMatch(provider, /loadUserContext\(|checkSession/, "the check and the load run only inside the limit");
  });

  test("only a new refresh and a sign-out move the ticket on, so a late answer still lands", () => {
    assert.deepEqual(provider.match(/request\.current (?:\+=|=)|\+\+request\.current/g), ["++request.current", "request.current +="]);
    assert.match(refreshModule, /void loadWithinLimit\(\(\) => answer, ms\)\.then\(\(ended\) => \{\s*if \(!ended\) set\.setStatus\(statusPastLimit\);\s*\}\);\s*return answer;/);
    assert.doesNotMatch(refreshModule, /AbortController|abort\(/, "nothing is cancelled");
  });
});
