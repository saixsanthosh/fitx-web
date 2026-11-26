// Review security:R3-SEC-2: "Sign out everywhere" counted as done whenever supabase.auth.signOut({ scope: "global" })
// returned no error, and the sign-in page then said every device was signed out. supabase-js returns no error without
// ending anything in two cases: this browser holds no session (it sends nothing), or Auth refuses the logout with 401,
// 403 or 404, which it ignores. Auth refuses it with 403 session_not_found when this device's own session has already
// ended while its access token still looks valid here (for up to an hour): after a password change in another session,
// or "sign out other sessions" sent from another session, perhaps the very one the member wanted ended. Now FITX asks
// Auth about this session first, then sends the logout itself and reads Auth's answer: only Auth's yes is "signed out
// everywhere". A session that was already over is signed out here and says the other devices may still be signed in.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AuthApiError, AuthClient, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";
import {
  addressNotice,
  noticeProofCookie,
  SIGNED_OUT_ENDED,
  SIGNED_OUT_EVERYWHERE,
  SIGNED_OUT_HERE,
  signedOutAddress,
  signedOutProof,
  takeNoticeProof,
} from "@/lib/auth/address-messages";
import { endEverySession, refusalMeans, signOutWithDeviceActivity, type SignOutClient } from "@/lib/auth/device-sign-out";
import { MemoryRecordingStore, type StoredRecording } from "@/lib/activity/local-store";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const T0 = Date.UTC(2026, 10, 16, 1, 0, 0);
const never = <T>() => new Promise<T>(() => undefined);
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.test", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T00:00:00Z" };

/** A recording this device keeps for the member that can't be uploaded, so only the sign-out's clean-up removes it. */
function kept(userId = USER.id): StoredRecording {
  return { clientId: `rec-${userId}`, userId, sport: "run", startedAt: T0, state: "finished", updatedAt: T0, uploadRejected: true };
}
async function storeWith(...recordings: StoredRecording[]) {
  const store = new MemoryRecordingStore(true);
  for (const recording of recordings) await store.saveRecording(recording);
  return store;
}
/** The device-recording steps, kept quick: the upload code never loads, so what is kept is asked about and cleared. */
const device = (store: MemoryRecordingStore) => ({ openStore: async () => store, loadPrepare: never, prepareLimitMs: 30, locks: null, ask: () => true });

type UserAnswer = { data: { user: unknown } | null; error: unknown };

/** A client whose Auth answers as told; every call is recorded. */
function fakeClient({ user, logout = async () => ({ error: null }), session = { user: { id: USER.id }, access_token: "token-1" } }: {
  user: () => Promise<UserAnswer>;
  logout?: () => Promise<{ error: unknown }>;
  session?: { user: { id: string }; access_token?: string } | null;
}) {
  const calls: string[] = [];
  const supabase: SignOutClient = {
    from: () => { throw new Error("no queries expected"); },
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signOut: async ({ scope }) => { calls.push(`signOut:${scope}`); return { error: null }; },
      getUser: async () => { calls.push("getUser"); return user(); },
      admin: { signOut: async (jwt, scope) => { calls.push(`logout:${scope}:${jwt}`); return logout(); } },
    },
  };
  return { supabase, calls };
}
const live = async (): Promise<UserAnswer> => ({ data: { user: USER }, error: null });
const refused = (error: unknown) => async (): Promise<UserAnswer> => ({ data: { user: null }, error });

describe("what Auth's refusals say about this device's session", () => {
  test("a session that is over", () => {
    assert.equal(refusalMeans(new AuthSessionMissingError()), "ended", "no session here, or Auth's session_not_found");
    for (const code of ["session_not_found", "session_expired", "refresh_token_not_found", "refresh_token_already_used", "user_not_found", "user_banned", "bad_jwt", "invalid_jwt", "no_authorization"]) {
      assert.equal(refusalMeans(new AuthApiError("over", 400, code)), "ended", code);
    }
    assert.equal(refusalMeans(new AuthApiError("no", 401, undefined)), "ended");
    assert.equal(refusalMeans(new AuthApiError("no", 403, undefined)), "ended");
  });

  test("a check that failed proves nothing", () => {
    assert.equal(refusalMeans(new AuthRetryableFetchError("Failed to fetch", 0)), "unknown", "offline");
    assert.equal(refusalMeans(new AuthRetryableFetchError("Bad gateway", 502)), "unknown");
    assert.equal(refusalMeans(new AuthUnknownError("not json", null)), "unknown");
    assert.equal(refusalMeans(new AuthApiError("slow down", 429, "over_request_rate_limit")), "unknown", "a rate limit");
    assert.equal(refusalMeans(new AuthApiError("oops", 500, undefined)), "unknown");
    for (const odd of [null, undefined, "weird", 0]) assert.equal(refusalMeans(odd), "unknown", String(odd));
  });
});

describe("Sign out everywhere with Auth's answers", () => {
  test("Auth ends every session: signed out everywhere, then this device, recordings off it", async () => {
    const store = await storeWith(kept(), kept("someone-else"));
    const { supabase, calls } = fakeClient({ user: live });
    assert.equal(await signOutWithDeviceActivity(supabase, { scope: "global", ...device(store) }), "signed_out");
    assert.deepEqual(calls, ["getUser", "logout:global:token-1", "signOut:local"]);
    assert.deepEqual(await store.listRecordings(USER.id), []);
    assert.equal((await store.listRecordings("someone-else")).length, 1);
  });

  test("no session stored in this browser: nothing to end the others with, and no logout is sent", async () => {
    const { supabase, calls } = fakeClient({ user: refused(new AuthSessionMissingError()), session: null });
    assert.equal(await signOutWithDeviceActivity(supabase, { scope: "global", ...device(new MemoryRecordingStore(true)) }), "ended");
    assert.deepEqual(calls, ["getUser", "signOut:local"], "signOut({ scope: \"global\" }) is never trusted here");
  });

  test("Auth says this device's session has ended (403 session_not_found): ended, this device signed out", async () => {
    const store = await storeWith(kept());
    for (const error of [new AuthSessionMissingError(), new AuthApiError("expired", 403, "bad_jwt"), new AuthApiError("gone", 400, "refresh_token_not_found")]) {
      const { supabase, calls } = fakeClient({ user: refused(error) });
      assert.equal(await signOutWithDeviceActivity(supabase, { scope: "global", ...device(store) }), "ended", error.message);
      assert.deepEqual(calls, ["getUser", "signOut:local"], "no logout with a token Auth refuses");
    }
    assert.deepEqual(await store.listRecordings(USER.id), [], "signed out here, so the recordings go");
  });

  test("the session ends between the check and the logout: Auth's refusal of the logout is ended, never success", async () => {
    for (const error of [new AuthSessionMissingError(), new AuthApiError("no", 401, "no_authorization"), new AuthApiError("no", 403, undefined), new AuthApiError("gone", 404, "user_not_found")]) {
      const { supabase, calls } = fakeClient({ user: live, logout: async () => ({ error }) });
      assert.equal(await signOutWithDeviceActivity(supabase, { scope: "global", ...device(new MemoryRecordingStore(true)) }), "ended", error.message);
      assert.deepEqual(calls, ["getUser", "logout:global:token-1", "signOut:local"]);
    }
  });

  test("Auth can't be asked, or doesn't confirm: failed, still signed in, recordings kept", async () => {
    const store = await storeWith(kept());
    const cases: Array<{ user: () => Promise<UserAnswer>; logout?: () => Promise<{ error: unknown }>; label: string }> = [
      { user: refused(new AuthRetryableFetchError("Failed to fetch", 0)), label: "offline at the check" },
      { user: refused(new AuthApiError("down", 500, undefined)), label: "a server error at the check" },
      { user: async () => { throw new TypeError("broken"); }, label: "a check that throws" },
      { user: live, logout: async () => ({ error: new AuthRetryableFetchError("Failed to fetch", 0) }), label: "offline at the logout" },
      { user: live, logout: async () => ({ error: new AuthApiError("slow down", 429, "over_request_rate_limit") }), label: "a rate limit at the logout" },
    ];
    for (const { user, logout, label } of cases) {
      const { supabase, calls } = fakeClient({ user, logout });
      assert.equal(await signOutWithDeviceActivity(supabase, { scope: "global", ...device(store) }), "failed", label);
      assert.ok(!calls.includes("signOut:local"), `${label}: this device stays signed in`);
    }
    assert.equal((await store.listRecordings(USER.id)).length, 1, "nothing removed");
  });

  test("no token to send after the check (the session went meanwhile): ended", async () => {
    const { supabase, calls } = fakeClient({ user: live, session: { user: { id: USER.id } } });
    assert.equal(await endEverySession(supabase.auth), "ended");
    assert.deepEqual(calls, ["getUser"]);
  });

  test("a client that can't ask Auth can't sign out everywhere", async () => {
    const { supabase, calls } = fakeClient({ user: live });
    assert.equal(await endEverySession({ ...supabase.auth, getUser: undefined }), "unknown");
    assert.equal(await endEverySession({ ...supabase.auth, admin: undefined }), "unknown");
    assert.deepEqual(calls, [], "nothing sent");
  });
});

// The real supabase-js auth client, with its auth server replaced by `answer` (as tests/account/session-state.test.ts
// does for Settings), so supabase-js's own handling of each answer is what is tested.
function realClient(answer: (request: { method: string; path: string }) => Response | Promise<Response>, { signedIn = true } = {}) {
  const store = new Map<string, string>();
  const storageKey = "sb-test-auth-token";
  if (signedIn) {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    store.set(storageKey, JSON.stringify({ access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user: USER }));
  }
  const requests: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const request = { method: init?.method ?? "GET", path: `${url.pathname}${url.search}` };
    requests.push(`${request.method} ${request.path}`);
    return answer(request);
  };
  const auth = new AuthClient({
    url: "https://auth.example.test/auth/v1",
    storage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) },
    storageKey,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    fetch: fetch as typeof globalThis.fetch,
  });
  const supabase: SignOutClient = { from: () => { throw new Error("no queries expected"); }, auth };
  return { supabase, auth, requests, signedInHere: () => store.has(storageKey) };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const SESSION_NOT_FOUND = { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" };
/** Auth as it answers once the session behind the token has ended: every call with that token is refused. */
const ended = () => json(403, SESSION_NOT_FOUND);
/** Auth with the session alive: the user, and a logout that ends every session (after it, the token is refused). */
function alive() {
  let over = false;
  return ({ method, path }: { method: string; path: string }) => {
    if (over) return ended();
    if (method === "GET" && path === "/auth/v1/user") return json(200, USER);
    if (method === "POST" && path === "/auth/v1/logout?scope=global") {
      over = true;
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path === "/auth/v1/logout?scope=local") return new Response(null, { status: 204 });
    return json(404, { msg: `no route for ${method} ${path}` });
  };
}

describe("with supabase-js itself", () => {
  test("its own signOut({ scope: \"global\" }) reports success when Auth refused, and when there was nothing to send", async () => {
    // Why FITX no longer takes that answer as proof (auth-js 2.108.2's _signOut ignores 401, 403 and 404).
    const refusedLogout = realClient(ended);
    assert.deepEqual(await refusedLogout.auth.signOut({ scope: "global" }), { error: null });
    assert.deepEqual(refusedLogout.requests, ["POST /auth/v1/logout?scope=global"]);
    const nothingStored = realClient(ended, { signedIn: false });
    assert.deepEqual(await nothingStored.auth.signOut({ scope: "global" }), { error: null });
    assert.deepEqual(nothingStored.requests, [], "no request at all");
  });

  test("Auth confirms: signed out everywhere, and this device's session is gone", async () => {
    const client = realClient(alive());
    assert.equal(await signOutWithDeviceActivity(client.supabase, { scope: "global", ...device(new MemoryRecordingStore(true)) }), "signed_out");
    assert.deepEqual(client.requests, ["GET /auth/v1/user", "POST /auth/v1/logout?scope=global", "POST /auth/v1/logout?scope=local"]);
    assert.equal(client.signedInHere(), false);
  });

  test("a session Auth had already ended (403 session_not_found): ended, no logout sent, this device signed out", async () => {
    const client = realClient(ended);
    assert.equal(await signOutWithDeviceActivity(client.supabase, { scope: "global", ...device(new MemoryRecordingStore(true)) }), "ended");
    assert.deepEqual(client.requests, ["GET /auth/v1/user"], "supabase-js forgets the ended session at the check, so nothing else is sent");
    assert.equal(client.signedInHere(), false);
  });

  test("no session stored in this browser: ended, with no request", async () => {
    const client = realClient(alive(), { signedIn: false });
    assert.equal(await signOutWithDeviceActivity(client.supabase, { scope: "global", ...device(new MemoryRecordingStore(true)) }), "ended");
    assert.deepEqual(client.requests, []);
  });

  test("the session ends between the check and the logout: Auth's refusal is ended", async () => {
    let checked = false;
    const client = realClient(({ method, path }) => {
      if (!checked && method === "GET" && path === "/auth/v1/user") {
        checked = true;
        return json(200, USER);
      }
      return ended();
    });
    assert.equal(await signOutWithDeviceActivity(client.supabase, { scope: "global", ...device(new MemoryRecordingStore(true)) }), "ended");
    assert.deepEqual(client.requests, ["GET /auth/v1/user", "POST /auth/v1/logout?scope=global", "POST /auth/v1/logout?scope=local"]);
    assert.equal(client.signedInHere(), false);
  });

  test("offline, or Auth down: failed, and this device stays signed in", async (t) => {
    t.mock.method(console, "error", () => undefined); // supabase-js logs failed fetches
    const offline = realClient(async () => { throw new TypeError("Failed to fetch"); });
    assert.equal(await signOutWithDeviceActivity(offline.supabase, { scope: "global", ...device(new MemoryRecordingStore(true)) }), "failed");
    assert.equal(offline.signedInHere(), true);
    const down = realClient(({ path }) => (path === "/auth/v1/user" ? json(200, USER) : json(503, { msg: "Service unavailable" })));
    assert.equal(await signOutWithDeviceActivity(down.supabase, { scope: "global", ...device(new MemoryRecordingStore(true)) }), "failed");
    assert.deepEqual(down.requests, ["GET /auth/v1/user", "POST /auth/v1/logout?scope=global"]);
    assert.equal(down.signedInHere(), true);
  });

  test("Log out is unchanged: one local logout", async () => {
    const client = realClient(alive());
    assert.equal(await signOutWithDeviceActivity(client.supabase, { ...device(new MemoryRecordingStore(true)) }), "signed_out");
    assert.deepEqual(client.requests, ["POST /auth/v1/logout?scope=local"]);
    assert.equal(client.signedInHere(), false);
  });
});

describe("what the sign-in page says afterwards", () => {
  test("each outcome lands on its own address, with its own proof", () => {
    assert.equal(signedOutAddress("global", "signed_out"), "/signin?signed_out=everywhere");
    assert.equal(signedOutAddress("global", "ended"), "/signin?signed_out=ended");
    assert.equal(signedOutAddress("local"), "/signin?signed_out=1");
    assert.equal(signedOutProof("global", "signed_out"), "everywhere");
    assert.equal(signedOutProof("global", "ended"), "ended");
    assert.equal(signedOutProof("local", "signed_out"), null, "Log out claims this device only, which needs no proof");
  });

  test("a session that was already over never reads as signed out everywhere", () => {
    const search = new URL(signedOutAddress("global", "ended"), "https://fitnessx.vercel.app").search;
    assert.equal(addressNotice(search, "ended"), SIGNED_OUT_ENDED);
    assert.equal(addressNotice(search, "everywhere"), SIGNED_OUT_HERE, "another sign-out's proof doesn't fit this address");
    assert.equal(addressNotice(search), SIGNED_OUT_HERE, "a link to it alone says this device only");
    assert.notEqual(SIGNED_OUT_ENDED, SIGNED_OUT_EVERYWHERE);
    assert.match(SIGNED_OUT_ENDED, /^This device was already signed out, so FITX couldn’t sign out your other devices\./);
    assert.match(SIGNED_OUT_ENDED, /Sign in again, then use Sign out everywhere in Settings\.$/, "what to do, with the button's own name");
    // The round trip: what LogoutButton leaves, then what the page reads.
    let cookie = "";
    const page = { get cookie() { return cookie; }, set cookie(text: string) { cookie = /Max-Age=0/.test(text) ? "" : text.split(";")[0]; } };
    page.cookie = noticeProofCookie("ended", true);
    assert.equal(addressNotice(search, takeNoticeProof(page, true)), SIGNED_OUT_ENDED);
  });

  test("LogoutButton lands where the outcome says, with the proof that outcome leaves", () => {
    const button = read("src/components/app/LogoutButton.tsx");
    assert.match(button, /const proof = signedOutProof\(scope, outcome\);\s*if \(proof\) document\.cookie = noticeProofCookie\(proof, secure\);\s*window\.location\.replace\(signedOutAddress\(scope, outcome\)\);/);
    // A failed or unconfirmed one keeps the member where they are, signed in, with the message by the button.
    assert.match(button, /if \(outcome === "failed"\) \{\s*setBusy\(false\);\s*setError\("We couldn’t sign out your devices\. Check your connection and try again\."\);\s*return;\s*\}/);
  });
});
