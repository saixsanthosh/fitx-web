// An ended session is told apart from a failed check (bug 41): Settings said "Your account details could not be
// loaded. Reload to try again." when the member had been signed out everywhere, or when Back showed Settings after
// Log out (src/components/account/session-state.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AuthApiError, AuthClient, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";
import { checkSession, checkSessionKeepingMember, confirmSignedOut, sessionState, signInHref } from "@/components/account/session-state";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.test" };

describe("sessionState", () => {
  test("a user and no error is signed in; no user and no error is signed out", () => {
    assert.equal(sessionState({ data: { user: USER }, error: null }), "signed_in");
    assert.equal(sessionState({ data: { user: null }, error: null }), "signed_out");
    assert.equal(sessionState(null), "signed_out");
  });

  test("no session in this browser, or one the server ended, is signed out", () => {
    assert.equal(sessionState({ data: { user: null }, error: new AuthSessionMissingError() }), "signed_out");
    for (const code of ["session_not_found", "refresh_token_not_found", "refresh_token_already_used", "user_not_found", "session_expired", "bad_jwt"]) {
      assert.equal(sessionState({ data: { user: null }, error: new AuthApiError("ended", 400, code) }), "signed_out", code);
    }
    assert.equal(sessionState({ data: { user: null }, error: new AuthApiError("no", 401, undefined) }), "signed_out");
    assert.equal(sessionState({ data: { user: null }, error: new AuthApiError("no", 403, undefined) }), "signed_out");
  });

  test("a check that failed says nothing about the session", () => {
    assert.equal(sessionState({ data: { user: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) }), "unknown", "offline");
    assert.equal(sessionState({ data: { user: null }, error: new AuthRetryableFetchError("Bad gateway", 502) }), "unknown", "a 5xx");
    assert.equal(sessionState({ data: { user: null }, error: new AuthUnknownError("not json", null) }), "unknown");
    assert.equal(sessionState({ data: { user: null }, error: new AuthApiError("oops", 500, undefined) }), "unknown");
    assert.equal(sessionState({ data: { user: null }, error: "weird" }), "unknown");
  });

  test("the sign-in link brings the member back", () => {
    assert.equal(signInHref("/settings"), "/signin?next=%2Fsettings");
    assert.equal(signInHref("/settings#your-data"), "/signin?next=%2Fsettings%23your-data");
  });
});

// The real supabase-js auth client, with its auth server replaced by `answer`.
function client(answer: () => Promise<Response>, { signedIn = true } = {}) {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
  const storageKey = "sb-test-auth-token";
  if (signedIn) {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    store.set(storageKey, JSON.stringify({ access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user: USER }));
  }
  const auth = new AuthClient({ url: "https://auth.example.test/auth/v1", storage, storageKey, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, fetch: answer as typeof fetch });
  return { auth, store, storageKey };
}

const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("checkSession with supabase-js's own answers", () => {
  test("signed in", async () => {
    const { auth } = client(json(200, { ...USER, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T00:00:00Z" }));
    const result = await checkSession(() => auth.getUser());
    assert.equal(result.state, "signed_in");
    assert.equal(result.user?.id, USER.id);
  });

  test("signed out everywhere from another device: the server's session_not_found", async () => {
    const { auth, store, storageKey } = client(json(403, { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" }));
    assert.deepEqual(await checkSession(() => auth.getUser()), { state: "signed_out", user: null });
    assert.equal(store.has(storageKey), false, "supabase-js forgets the ended session too");
  });

  test("Back after Log out: no session left in this browser", async () => {
    const { auth } = client(json(200, USER), { signedIn: false });
    assert.deepEqual(await checkSession(() => auth.getUser()), { state: "signed_out", user: null });
  });

  test("offline or a server error is a failed check, and the session is kept", async (t) => {
    t.mock.method(console, "error", () => undefined); // supabase-js logs the failed fetch
    const offline = client(async () => { throw new TypeError("Failed to fetch"); });
    assert.deepEqual(await checkSession(() => offline.auth.getUser()), { state: "unknown", user: null });
    assert.equal(offline.store.has(offline.storageKey), true);
    const down = client(json(503, { msg: "upstream unavailable" }));
    assert.deepEqual(await checkSession(() => down.auth.getUser()), { state: "unknown", user: null });
  });

  test("a getUser that throws is a failed check", async () => {
    assert.deepEqual(await checkSession(async () => { throw new Error("boom"); }), { state: "unknown", user: null });
  });
});

describe("checkSessionKeepingMember (Home, review home-1)", () => {
  const offline = async () => { throw new TypeError("Failed to fetch"); };

  test("signed in, and signed out everywhere: the server's answer, nothing read locally", async () => {
    const { auth } = client(json(200, { ...USER, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T00:00:00Z" }));
    assert.deepEqual(await checkSessionKeepingMember(auth), { state: "signed_in", userId: USER.id });
    const ended = client(json(403, { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" }));
    assert.deepEqual(await checkSessionKeepingMember(ended.auth), { state: "signed_out", userId: null });
    const none = client(json(200, USER), { signedIn: false });
    assert.deepEqual(await checkSessionKeepingMember(none.auth), { state: "signed_out", userId: null }, "Back after Log out");
  });

  test("offline or a 503: still unknown, with the member this browser's session names, read without the network", async (t) => {
    t.mock.method(console, "error", () => undefined);
    assert.deepEqual(await checkSessionKeepingMember(client(offline).auth), { state: "unknown", userId: USER.id });
    assert.deepEqual(await checkSessionKeepingMember(client(json(503, { msg: "upstream unavailable" })).auth), { state: "unknown", userId: USER.id });
  });

  test("offline with an expired access token: the session can't be renewed, so no member", async () => {
    // What supabase-js answers then, after its refresh back-off (about 25 s, so not run for real here).
    const failed = () => new AuthRetryableFetchError("Failed to fetch", 0);
    const expired = {
      getUser: async () => ({ data: { user: null }, error: failed() }),
      getSession: async () => ({ data: { session: null }, error: failed() }),
    };
    assert.deepEqual(await checkSessionKeepingMember(expired), { state: "unknown", userId: null });
  });

  test("no Supabase client, or a session read that throws, is a check that couldn't be made", async () => {
    assert.deepEqual(await checkSessionKeepingMember(null), { state: "unknown", userId: null });
    const broken = {
      getUser: async () => ({ data: { user: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) }),
      getSession: async () => { throw new Error("storage blocked"); },
    };
    assert.deepEqual(await checkSessionKeepingMember(broken), { state: "unknown", userId: null });
  });
});

describe("confirmSignedOut (the shared context also says signed_out when its check failed)", () => {
  test("any other status passes through", () => {
    for (const status of ["loading", "ready", "unavailable", "error"] as const) assert.equal(confirmSignedOut(status, null), status);
  });

  test("signed out only once the page's own check agrees; until then loading; a failed check is an error to retry", () => {
    assert.equal(confirmSignedOut("signed_out", null), "loading");
    assert.equal(confirmSignedOut("signed_out", "signed_out"), "signed_out");
    assert.equal(confirmSignedOut("signed_out", "unknown"), "error", "offline: never \"Sign in to see your profile.\"");
    assert.equal(confirmSignedOut("signed_out", "signed_in"), "error", "the context is out of date: Try again reloads it");
  });
});

describe("Settings and Profile use it", () => {
  const read = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");

  test("Settings > Account: an ended session says so, offers sign-in, and offers no sign-out", () => {
    const account = read("app/(dashboard)/settings/SettingsAccount.tsx");
    assert.match(account, /const \{ state, user \} = await checkSession<User>\(\(\) => supabase\.auth\.getUser\(\)\);/);
    assert.match(account, /setView\(\{ kind: state === "signed_out" \? "signed_out" : "failed" \}\);/);
    assert.match(account, /You’re signed out\. Sign in again to see your account\./);
    assert.match(account, /<Link href=\{signInHref\("\/settings"\)\}/);
    assert.match(account, /\{view\.kind !== "signed_out" && \(\s*<div[^>]*>\s*<LogoutButton \/>\s*<LogoutButton scope="global" \/>/);
    assert.match(account, /if \(event\.persisted\) void check\(\);/, "checked again when Back brings the page back from the cache");
    assert.match(account, /if \(event !== "SIGNED_OUT" \|\| !live\) return;/);
  });

  test("Download my data and Profile tell an ended session from a failed check", () => {
    const download = read("app/(dashboard)/settings/SettingsData.tsx");
    assert.match(download, /if \(session === "signed_out"\) return setState\(\{ kind: "signed_out"/);
    // D5: the button stays focusable while it works, and a second press then does nothing.
    assert.match(download, /if \(state\.kind === "working"\) return;/);
    assert.match(download, /aria-disabled=\{state\.kind === "working" \|\| undefined\}/);
    assert.doesNotMatch(download, /disabled=\{state\.kind === "working"\}/);
    const profile = read("app/(dashboard)/profile/ProfileView.tsx");
    assert.match(profile, /status: state === "signed_out" \? "signed_out" : "error"/);
    assert.match(profile, /if \(event\.persisted\) void reload\(\);/);
    // With the shared context: its "signed_out" is checked before Profile says "Sign in to see your profile." (home-1).
    assert.match(profile, /const sharedSignedOut = shared\?\.status === "signed_out";/);
    assert.match(profile, /const status = confirmSignedOut\(shared\.status, own\);/);
    assert.match(profile, /\}, \[sharedSignedOut, attempt\]\);/, "checked again on each reload while the context says signed out");
    assert.match(profile, /setAttempt\(\(count\) => count \+ 1\);\s*await refreshShared\?\.\(\);/, "Try again checks the session again too");
  });

  test("Delete my account says the member is signed out rather than asking for a recent sign-in", () => {
    const remove = read("components/account/DeleteAccount.tsx");
    assert.match(remove, /if \(response\.status === 401\) \{\s*return \{ kind: "ok", signedOut: true,/);
    assert.match(remove, /You’re signed out\. Sign in again and you’ll come back here to finish\./);
  });
});
