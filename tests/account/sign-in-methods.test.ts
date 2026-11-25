// Settings > Account > Sign-in methods (bug 27): an account made with "Email me a code" was listed as "Email and
// password" although it has no password (src/components/account/sign-in-methods.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AuthClient } from "@supabase/supabase-js";
import { EMAIL_CODE, PASSWORD, PASSWORD_NOTE, accountProviders, sessionMethods, signInMethods } from "@/components/account/sign-in-methods";

// The hunt's code-only account, as GET /auth/v1/user returned it (verify/settings-account-sign-in-methods/10-auth-user-fields.json).
const CODE_ONLY = { identities: [{ provider: "email" }], appMetadata: { provider: "email", providers: ["email"] } };

describe("naming the sign-in methods", () => {
  test("an account made with an email code, signed in with a code: Email code, never a password", () => {
    const named = signInMethods({ ...CODE_ONLY, amr: [{ method: "otp", timestamp: 1795632000 }] });
    assert.deepEqual(named, { methods: [EMAIL_CODE], passwordNote: true });
    assert.ok(!named.methods.some((method) => /password/i.test(method)));
    assert.equal(EMAIL_CODE, "Email code");
  });

  test("a session signed in with a password shows the password too", () => {
    assert.deepEqual(signInMethods({ ...CODE_ONLY, amr: [{ method: "password", timestamp: 1795632000 }] }), { methods: [EMAIL_CODE, PASSWORD], passwordNote: false });
    assert.deepEqual(signInMethods({ ...CODE_ONLY, amr: ["password"] }), { methods: [EMAIL_CODE, PASSWORD], passwordNote: false }, "amr as plain strings");
  });

  test("when the session doesn't say (a magic link, a reset, an unreadable token), no password is claimed and the note stays", () => {
    for (const amr of [[{ method: "magiclink" }], [{ method: "recovery" }], [], null]) {
      assert.deepEqual(signInMethods({ ...CODE_ONLY, amr }), { methods: [EMAIL_CODE], passwordNote: true }, JSON.stringify(amr));
    }
    assert.equal(PASSWORD_NOTE, "If you also set a password, it still works.");
  });

  test("Google and Apple come from their identities; Google alone has no email code or note", () => {
    assert.deepEqual(signInMethods({ identities: [{ provider: "google" }], appMetadata: { provider: "google" }, amr: [{ method: "oauth" }] }), { methods: ["Google"], passwordNote: false });
    assert.deepEqual(signInMethods({ identities: [{ provider: "email" }, { provider: "google" }], appMetadata: null, amr: [{ method: "oauth" }] }), { methods: [EMAIL_CODE, "Google"], passwordNote: true });
    assert.deepEqual(signInMethods({ identities: [{ provider: "apple" }], appMetadata: null, amr: [] }).methods, ["Apple"]);
    assert.deepEqual(signInMethods({ identities: [{ provider: "github" }], appMetadata: null, amr: [] }).methods, ["Github"]);
  });

  test("without identities the app metadata decides, and an account with nothing listed is an email account", () => {
    assert.deepEqual(accountProviders([], { provider: "email", providers: ["email", "google"] }), ["email", "google"]);
    assert.deepEqual(accountProviders(undefined, { provider: "google" }), ["google"]);
    assert.deepEqual(accountProviders(null, null), ["email"]);
    assert.deepEqual(accountProviders([{ provider: "email" }, { provider: "email" }], null), ["email"], "each provider once");
  });

  test("amr entries are read case-insensitively and junk is ignored", () => {
    assert.deepEqual(sessionMethods([{ method: "PASSWORD" }, { method: 4 } as never, {}, "otp"]), ["password", "otp"]);
  });
});

// supabase-js's own reading of the session's amr, as Settings asks for it.
function jwt(payload: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}.${Buffer.from("not checked here").toString("base64url")}`;
}

async function amrOf(method: string) {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = jwt({ sub: "u1", aal: "aal1", exp: expiresAt, amr: [{ method, timestamp: expiresAt - 3600 }], session_id: "s1" });
  store.set("sb-test-auth-token", JSON.stringify({ access_token: token, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user: { id: "u1", factors: [] } }));
  const auth = new AuthClient({ url: "https://auth.example.test/auth/v1", storage, storageKey: "sb-test-auth-token", autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, fetch: (async () => { throw new Error("no network needed"); }) as typeof fetch });
  const { data } = await auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentAuthenticationMethods ?? [];
}

describe("the session's sign-in method, read the way Settings reads it", () => {
  test("a code sign-in and a password sign-in", async () => {
    assert.deepEqual(signInMethods({ ...CODE_ONLY, amr: await amrOf("otp") }).methods, [EMAIL_CODE]);
    assert.deepEqual(signInMethods({ ...CODE_ONLY, amr: await amrOf("password") }).methods, [EMAIL_CODE, PASSWORD]);
  });
});

describe("Settings uses it", () => {
  const account = readFileSync(new URL("../../src/app/(dashboard)/settings/SettingsAccount.tsx", import.meta.url), "utf8");

  test("no fixed \"Email and password\" any more; the amr is read after the session check", () => {
    assert.doesNotMatch(account, /Email and password/);
    assert.match(account, /\.\.\.signInMethods\(\{ identities: user\.identities, appMetadata: user\.app_metadata, amr \}\)/);
    assert.match(account, /const amr = state === "signed_in" \? await sessionAmr\(supabase\) : \[\];/);
    assert.match(account, /<SettingsRow label="Sign-in methods" hint=\{view\.account\.passwordNote \? PASSWORD_NOTE : undefined\}>/);
  });
});
