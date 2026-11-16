import test from "node:test";
import assert from "node:assert/strict";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { checkAdminEmail, normaliseEmail, parseAllowlist } = await importTypeScriptModule("src/lib/admin-email.ts");
const { describeError, redact } = await importTypeScriptModule("src/lib/log.ts");

function googleUser(overrides = {}) {
  return {
    email: "owner@example.com",
    email_confirmed_at: "2026-11-16T10:00:00Z",
    identities: [{ provider: "google", identity_data: { email: "owner@example.com", email_verified: true } }],
    ...overrides,
  };
}

test("the allowlist ignores letter case, spacing and separators, and drops non-emails", () => {
  const allowlist = parseAllowlist(" Owner@Example.com, second@example.com;third@example.com\nfourth@example.com ,, not-an-email ");
  assert.deepEqual([...allowlist], ["owner@example.com", "second@example.com", "third@example.com", "fourth@example.com"]);
  assert.equal(parseAllowlist(undefined).size, 0);
  assert.equal(parseAllowlist(" , ").size, 0);
});

test("a confirmed Google account on the allowlist passes, whatever the letter case", () => {
  const result = checkAdminEmail(googleUser({ email: "Owner@Example.com" }), parseAllowlist("OWNER@example.com"));
  assert.deepEqual(result, { ok: true, email: "owner@example.com" });
});

test("an account that is not on the allowlist is refused", () => {
  assert.deepEqual(checkAdminEmail(googleUser(), parseAllowlist("someone-else@example.com")), { ok: false, reason: "not_allowlisted" });
  assert.deepEqual(checkAdminEmail(googleUser(), parseAllowlist("")), { ok: false, reason: "not_allowlisted" });
});

test("an unconfirmed or missing email is refused even when the address is on the allowlist", () => {
  const allowlist = parseAllowlist("owner@example.com");
  assert.equal(checkAdminEmail(googleUser({ email_confirmed_at: null }), allowlist).reason, "unconfirmed_email");
  assert.equal(checkAdminEmail(googleUser({ email_confirmed_at: undefined }), allowlist).reason, "unconfirmed_email");
  assert.equal(checkAdminEmail(googleUser({ email: undefined }), allowlist).reason, "unconfirmed_email");
});

test("the email must belong to a verified Google identity on the same account", () => {
  const allowlist = parseAllowlist("owner@example.com");
  const refused = [
    { identities: [] },
    { identities: undefined },
    { identities: [{ provider: "email", identity_data: { email: "owner@example.com", email_verified: true } }] },
    { identities: [{ provider: "google", identity_data: { email: "owner@example.com" } }] },
    { identities: [{ provider: "google", identity_data: { email: "owner@example.com", email_verified: false } }] },
    { identities: [{ provider: "google", identity_data: { email: "other@example.com", email_verified: true } }] },
    { identities: [{ provider: "google", identity_data: null }] },
  ];
  for (const overrides of refused) {
    assert.equal(checkAdminEmail(googleUser(overrides), allowlist).reason, "no_verified_google_identity", JSON.stringify(overrides));
  }
});

test("an account with a password identity and a Google identity passes on the Google one", () => {
  const user = googleUser({
    identities: [
      { provider: "email", identity_data: { email: "owner@example.com", email_verified: false } },
      { provider: "google", identity_data: { email: "OWNER@example.com", email_verified: "true" } },
    ],
  });
  assert.equal(checkAdminEmail(user, parseAllowlist("owner@example.com")).ok, true);
});

test("normaliseEmail rejects values that are not email addresses", () => {
  for (const value of [null, undefined, 42, "", "owner", "owner@", "@example.com", "a b@example.com"]) {
    assert.equal(normaliseEmail(value), null, String(value));
  }
  assert.equal(normaliseEmail("  Owner@Example.COM "), "owner@example.com");
});

test("log lines mask emails, IDs, tokens and keys", () => {
  const text = redact(
    "user owner@example.com id 9f1c2b3a-1111-4222-8333-444455556666 token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln " +
    "key sb_secret_abc123XYZ hash 0123456789abcdef0123456789abcdef01\nnext line",
  );
  for (const secret of ["owner@example.com", "9f1c2b3a-1111", "eyJhbGci", "sb_secret_abc123XYZ", "0123456789abcdef0123456789abcdef01", "\n"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.match(text, /\[email\].*\[id\].*\[token\].*\[key\].*\[redacted\]/);
});

test("describeError keeps names, codes, statuses and short messages only", () => {
  const error = { code: "PGRST205", message: "Could not find the table 'public.fitx_admin_members'", details: "row detail", hint: "hint" };
  assert.equal(describeError(error), "code=PGRST205 message=\"Could not find the table 'public.fitx_admin_members'\"");
  assert.equal(describeError({ name: "AuthApiError", status: 400, message: "Invalid owner@example.com" }), "name=AuthApiError status=400 message=\"Invalid [email]\"");
  assert.equal(describeError(undefined), "");
  assert.equal(describeError("plain owner@example.com"), "message=\"plain [email]\"");
  assert.ok(describeError({ message: "x ".repeat(500) }).length <= 220);
});
