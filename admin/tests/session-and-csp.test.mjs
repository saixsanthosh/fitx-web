import test from "node:test";
import assert from "node:assert/strict";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { evaluateAdminSession, sessionSignedInAt, normaliseTotpCode, ADMIN_MAX_SESSION_SECONDS } = await importTypeScriptModule("src/lib/session-policy.ts");
const { buildAdminCsp, createNonce, originOf } = await importTypeScriptModule("src/lib/csp.ts");
const { csvCell, toCsv } = await importTypeScriptModule("src/lib/csv.ts");

const NOW = 1_800_000_000;
const signedIn = (secondsAgo, extra = []) => [{ method: "oauth", timestamp: NOW - secondsAgo }, ...extra];

test("the session signed in at its earliest authentication method, else at the token's issue time", () => {
  assert.equal(sessionSignedInAt([{ method: "totp", timestamp: NOW - 10 }, { method: "oauth", timestamp: NOW - 500 }]), NOW - 500);
  assert.equal(sessionSignedInAt([], NOW - 42), NOW - 42);
  assert.equal(sessionSignedInAt([{ method: "oauth", timestamp: "nonsense" }], undefined), null);
  assert.equal(sessionSignedInAt(undefined, undefined), null);
});

test("Admin sessions need an authenticator, then its code, and end 12 hours after sign-in", () => {
  const base = { nowSeconds: NOW, hasVerifiedFactor: true, aal: "aal2", amr: signedIn(60) };
  assert.equal(evaluateAdminSession(base).state, "ok");
  assert.equal(evaluateAdminSession({ ...base, hasVerifiedFactor: false, aal: "aal1" }).state, "enroll");
  assert.equal(evaluateAdminSession({ ...base, aal: "aal1" }).state, "verify");
  assert.equal(evaluateAdminSession({ ...base, amr: signedIn(ADMIN_MAX_SESSION_SECONDS - 1) }).state, "ok");
  assert.equal(evaluateAdminSession({ ...base, amr: signedIn(ADMIN_MAX_SESSION_SECONDS + 1) }).state, "expired");
  // A fresh authenticator code does not extend a session that signed in long ago.
  const lateCode = signedIn(ADMIN_MAX_SESSION_SECONDS + 5, [{ method: "totp", timestamp: NOW - 5 }]);
  assert.equal(evaluateAdminSession({ ...base, amr: lateCode }).state, "expired");
  assert.equal(evaluateAdminSession({ ...base, amr: null, issuedAt: undefined }).state, "expired");
});

test("authenticator codes are six digits, with spaces allowed", () => {
  assert.equal(normaliseTotpCode("123 456"), "123456");
  assert.equal(normaliseTotpCode(" 654321 "), "654321");
  for (const value of ["12345", "1234567", "12a456", "", null, 123456]) assert.equal(normaliseTotpCode(value), null, String(value));
});

test("the Admin CSP uses the nonce, blocks framing and inline code, and allows the sign-in redirect hosts", () => {
  const csp = buildAdminCsp({ nonce: "abc123==", supabaseOrigin: "https://demo.supabase.co", isDev: false, upgradeInsecureRequests: true });
  assert.match(csp, /script-src 'self' 'nonce-abc123==' 'strict-dynamic'(;|$)/);
  assert.match(csp, /style-src 'self' 'nonce-abc123=='/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self' https:\/\/demo\.supabase\.co https:\/\/accounts\.google\.com/);
  assert.match(csp, /img-src 'self' data: blob:/);
  assert.match(csp, /upgrade-insecure-requests$/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});

test("development relaxes only what React's dev tools need, and plain HTTP skips the upgrade", () => {
  const csp = buildAdminCsp({ nonce: "n", supabaseOrigin: null, isDev: true, upgradeInsecureRequests: false });
  assert.match(csp, /script-src 'self' 'nonce-n' 'strict-dynamic' 'unsafe-eval'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /form-action 'self' https:\/\/accounts\.google\.com/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
});

test("nonces are fresh base64 values and origins are parsed safely", () => {
  const nonces = new Set(Array.from({ length: 50 }, () => createNonce()));
  assert.equal(nonces.size, 50);
  for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
  assert.equal(originOf("https://demo.supabase.co/rest/v1"), "https://demo.supabase.co");
  assert.equal(originOf("javascript:alert(1)"), null);
  assert.equal(originOf("not a url"), null);
  assert.equal(originOf(undefined), null);
});

test("CSV cells are quoted and spreadsheet formulas are neutralised", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('say "hi", then go'), '"say ""hi"", then go"');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
  for (const value of ["+1", "-2", "@cmd", "\tx"]) assert.ok(csvCell(value).replace(/^"/, "").startsWith("'"), value);
  assert.equal(csvCell(null), "");
  assert.equal(csvCell({ before: { role: "admin" } }), '"{""before"":{""role"":""admin""}}"');
  assert.equal(toCsv(["a", "b"], [[1, "x,y"]]), 'a,b\r\n1,"x,y"\r\n');
});
