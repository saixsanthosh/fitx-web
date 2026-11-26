// The shared user context (UserContextProvider) tells an ended session from a check that failed (bug 41; shell edit 2
// asked by the home stream, reports-3/home.md). It said "signed_out" for every getUser() answer without a user,
// offline and a 5xx included, so with the sidebar's ended-session rule (accountSummary.ts) a member on a bad
// connection would have lost their name in the header as if signed out. It also checks again when Back brings a page
// back whole from the back-forward cache (D2).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AuthClient } from "@supabase/supabase-js";
import { checkSession, sharedStatusWithoutUser } from "@/components/account/session-state";
import { preferSharedAccount } from "@/components/layout/accountSummary";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.test" };

// The real supabase-js auth client, with its auth server replaced by `answer` (as tests/account/session-state does).
function client(answer: () => Promise<Response>, { signedIn = true } = {}) {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
  const storageKey = "sb-test-auth-token";
  if (signedIn) {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    store.set(storageKey, JSON.stringify({ access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user: USER }));
  }
  return new AuthClient({ url: "https://auth.example.test/auth/v1", storage, storageKey, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, fetch: answer as typeof fetch });
}
const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The status the provider sets for a check that gave no user. */
async function statusFor(auth: ReturnType<typeof client>) {
  const { state, user } = await checkSession(() => auth.getUser());
  assert.equal(user, null);
  return sharedStatusWithoutUser(state);
}

describe("the shared context's status without a user", () => {
  test("an ended session is signed out: signed out everywhere elsewhere, or no session left after Log out", async () => {
    assert.equal(await statusFor(client(json(403, { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" }))), "signed_out");
    assert.equal(await statusFor(client(json(200, USER), { signedIn: false })), "signed_out");
  });

  test("a check that failed is an error, never a sign-out: offline, a 5xx", async (t) => {
    t.mock.method(console, "error", () => undefined); // supabase-js logs the failed fetch
    assert.equal(await statusFor(client(async () => { throw new TypeError("Failed to fetch"); })), "error");
    assert.equal(await statusFor(client(json(503, { msg: "upstream unavailable" }))), "error");
    assert.equal(sharedStatusWithoutUser("unknown"), "error");
    assert.equal(sharedStatusWithoutUser("signed_out"), "signed_out");
  });

  test("so the header and sidebar keep the member's name offline and drop it only for an ended session", () => {
    const fetched = { name: "Asha", email: USER.email, avatarUrl: null };
    assert.equal(preferSharedAccount(fetched, { status: sharedStatusWithoutUser("unknown"), data: null, avatarUrl: null }), fetched);
    assert.equal(preferSharedAccount(fetched, { status: sharedStatusWithoutUser("signed_out"), data: null, avatarUrl: null }), null);
  });
});

describe("UserContextProvider's wiring", () => {
  const provider = readFileSync(new URL("../../src/components/app/UserContextProvider.tsx", import.meta.url), "utf8");
  // Since fix round 3e the provider's refresh runs refreshUserContext (user-context-refresh.ts), which adds the time limit
  // (tests/shell/user-context-refresh-limit.test.ts runs it with stand-ins, these statuses included).
  const refreshModule = readFileSync(new URL("../../src/components/app/user-context-refresh.ts", import.meta.url), "utf8");
  const refresh = refreshModule.slice(refreshModule.indexOf("export function refreshUserContext("));
  const providerRefresh = provider.slice(provider.indexOf("const refresh = useCallback("), provider.indexOf("useEffect(() => {"));

  test("refresh() checks the session with checkSession and sets the status from its state", () => {
    assert.match(providerRefresh, /await refreshUserContext\(supabase, \(\) => ticket === request\.current, \{/);
    assert.match(refresh, /const \{ state, user \} = await checkSession<User>\(\(\) => supabase\.auth\.getUser\(\)\);/);
    assert.match(refresh, /if \(!user\) \{\s*set\.setData\(null\);\s*set\.setFailedPart\(null\);\s*set\.setStatus\(sharedStatusWithoutUser\(state\)\);\s*return;\s*\}/);
    assert.match(refresh, /load\(supabase, \{ id: user\.id, email: user\.email \?\? null \}\)/);
    assert.doesNotMatch(refresh, /setStatus\("signed_out"\)/, "only an ended session, through the session's state");
    assert.doesNotMatch(providerRefresh, /setStatus\("signed_out"\)/);
  });

  test("a page brought back whole by Back or Forward checks again, and the listener goes with the provider", () => {
    assert.match(provider, /const onPageShow = \(event: PageTransitionEvent\) => \{\s*if \(event\.persisted\) void refresh\(\);\s*\};\s*window\.addEventListener\("pageshow", onPageShow\);/);
    assert.match(provider, /window\.removeEventListener\("pageshow", onPageShow\);/);
  });
});
