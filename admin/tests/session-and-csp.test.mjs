import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

import { createHash } from "node:crypto";
import { fake, resetFakes, SESSION_STUBS, setTestEnv, tableCalls } from "./helpers/fakes.mjs";

const policy = await importTypeScriptModule("src/lib/session-policy.ts");
const { buildAdminCsp, catalogueImageUrl, createNonce, EXERCISE_CATALOGUE_IMAGES, originOf } = await importTypeScriptModule("src/lib/csp.ts");
const { csvCell, toCsv } = await importTypeScriptModule("src/lib/csv.ts");
const { hashPassword } = await importTypeScriptModule("src/lib/password.ts");

// Made-up names and passwords only.
const ROOT_HASH = await hashPassword("made-up root passphrase");
const OPERATOR_HASH = await hashPassword("made-up operator passphrase");
setTestEnv({ FITX_ADMIN_USERNAME: "test-owner", FITX_ADMIN_PASSWORD_HASH: ROOT_HASH });
const sessions = await importTypeScriptModule("src/lib/admin-session.ts", SESSION_STUBS);

const NOW = Date.parse("2026-11-21T10:00:00Z");
const minutes = (count) => new Date(NOW - count * 60_000).toISOString();

beforeEach(() => {
  resetFakes();
  setTestEnv({ FITX_ADMIN_USERNAME: "test-owner", FITX_ADMIN_PASSWORD_HASH: ROOT_HASH });
});

test("sessions end 12 hours after sign-in, after 60 idle minutes, or when revoked", () => {
  const check = (createdAt, lastSeenAt, revokedAt = null) => policy.evaluateSessionRow({ createdAt, lastSeenAt, revokedAt, nowMs: NOW });
  assert.equal(policy.ADMIN_SESSION_ABSOLUTE_HOURS, 12);
  assert.equal(policy.ADMIN_SESSION_IDLE_MINUTES, 60);
  assert.equal(check(minutes(30), minutes(1)), "ok");
  assert.equal(check(minutes(12 * 60 - 1), minutes(0)), "ok");
  assert.equal(check(minutes(12 * 60), minutes(0)), "expired", "busy sessions still end at 12 hours");
  assert.equal(check(minutes(120), minutes(59)), "ok");
  assert.equal(check(minutes(120), minutes(60)), "idle");
  assert.equal(check(minutes(5), minutes(1), minutes(2)), "revoked");
  assert.equal(check("not a date", minutes(1)), "expired");
  assert.equal(check(new Date(NOW + 10 * 60_000).toISOString(), minutes(0)), "expired", "a future sign-in time is not trusted");
});

test("last_seen_at is written at most once a minute", () => {
  assert.equal(policy.shouldTouchSession(minutes(0.5), NOW), false);
  assert.equal(policy.shouldTouchSession(minutes(1), NOW), true);
  assert.equal(policy.shouldTouchSession(null, NOW), true);
});

test("the session cookie is __Host-, httpOnly, Secure, SameSite=Strict, Path=/, 12 hours", () => {
  assert.equal(policy.ADMIN_SESSION_COOKIE, "__Host-fitx_admin");
  assert.deepEqual(policy.sessionCookieOptions(), { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 43200 });
  assert.equal("domain" in policy.sessionCookieOptions(), false, "__Host- cookies carry no Domain");
});

test("the cookie is removed with the same flags it was set with, or browsers keep a __Host- cookie", () => {
  const expired = policy.expiredSessionCookieOptions();
  assert.deepEqual({ ...expired, expires: expired.expires.getTime() }, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0, expires: 0 });
  assert.equal("domain" in expired, false);
});

test("session tokens are 32 random bytes in base64url, stored only as their SHA-256", () => {
  const tokens = new Set(Array.from({ length: 50 }, () => sessions.newSessionToken()));
  assert.equal(tokens.size, 50);
  for (const token of tokens) {
    assert.equal(policy.isSessionToken(token), true);
    assert.equal(Buffer.from(token, "base64url").length, 32);
    assert.equal(sessions.hashSessionToken(token), createHash("sha256").update(token).digest("hex"));
  }
  for (const bad of ["", "short", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, null, 7]) assert.equal(policy.isSessionToken(bad), false, String(bad));
  assert.match(sessions.credentialStamp(ROOT_HASH), /^[0-9a-f]{16}$/);
  assert.notEqual(sessions.credentialStamp(ROOT_HASH), sessions.credentialStamp(OPERATOR_HASH));
});

test("user agents are clipped to 300 characters without control characters", () => {
  assert.equal(policy.clipUserAgent("x".repeat(400)).length, 300);
  assert.equal(policy.clipUserAgent("a\nb\u0000c"), "a b c");
  assert.equal(policy.clipUserAgent(""), null);
});

/** A session row as the database returns it, with its operator embedded. */
function sessionRow({ createdAt = minutes(10), lastSeenAt = minutes(5), revokedAt = null, stamp, operator }) {
  return { id: "00000000-0000-4000-8000-00000000005e", credential_stamp: stamp, created_at: createdAt, last_seen_at: lastSeenAt, revoked_at: revokedAt, admin_operators: operator };
}
const ROOT = { id: "r1", username: "test-owner", role: "super_admin", is_active: true, is_root: true, password_hash: null, must_change_password: false };
const AGENT = { id: "a1", username: "agent.one", role: "support_agent", is_active: true, is_root: false, password_hash: OPERATOR_HASH, must_change_password: false };

async function readWith(row) {
  const token = sessions.newSessionToken();
  fake.cookies.set("__Host-fitx_admin", token);
  fake.handler = (call) => (call.final === "maybeSingle" ? { data: row, error: null } : { data: null, error: null });
  const result = await sessions.readSessionOperator();
  const lookup = tableCalls("admin_web_sessions")[0];
  return { result, token, lookup, updates: tableCalls("admin_web_sessions").slice(1).map((call) => call.ops.find(([op]) => op === "update")?.[1]) };
}

test("a valid session cookie gives its operator, looked up by the token's hash", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const { result, token, lookup, updates } = await readWith(sessionRow({ stamp: sessions.credentialStamp(ROOT_HASH), operator: ROOT }));
  assert.deepEqual(result, { sessionId: "00000000-0000-4000-8000-00000000005e", operator: { id: "r1", username: "test-owner", role: "super_admin", isRoot: true, mustChangePassword: false } });
  assert.deepEqual(lookup.ops.find(([op]) => op === "eq"), ["eq", "token_hash", sessions.hashSessionToken(token)]);
  assert.deepEqual(Object.keys(updates[0]), ["last_seen_at"], "touched after five idle minutes");
});

test("no cookie, a malformed cookie or no row means no operator", async () => {
  assert.equal(await sessions.readSessionOperator(), null);
  fake.cookies.set("__Host-fitx_admin", "not-a-token");
  assert.equal(await sessions.readSessionOperator(), null);
  assert.equal(fake.calls.length, 0, "a malformed cookie never reaches the database");
  const { result } = await readWith(null);
  assert.equal(result, null);
});

test("expired, idle and revoked sessions are refused and the first two are marked ended", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const stamp = sessions.credentialStamp(ROOT_HASH);
  const expired = await readWith(sessionRow({ createdAt: minutes(12 * 60 + 1), lastSeenAt: minutes(1), stamp, operator: ROOT }));
  assert.equal(expired.result, null);
  assert.equal(expired.updates[0].revoked_reason, "expired");
  resetFakes();
  const idle = await readWith(sessionRow({ createdAt: minutes(200), lastSeenAt: minutes(61), stamp, operator: ROOT }));
  assert.equal(idle.result, null);
  assert.equal(idle.updates[0].revoked_reason, "idle");
  resetFakes();
  const revoked = await readWith(sessionRow({ revokedAt: minutes(1), stamp, operator: ROOT }));
  assert.equal(revoked.result, null);
  assert.equal(revoked.updates.length, 0);
});

test("a new password, a new root hash or a renamed root ends older sessions", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const oldStamp = sessions.credentialStamp(await hashPassword("made-up earlier passphrase"));
  const changed = await readWith(sessionRow({ stamp: oldStamp, operator: AGENT }));
  assert.equal(changed.result, null);
  assert.equal(changed.updates[0].revoked_reason, "credentials_changed");

  resetFakes();
  const rootStamp = sessions.credentialStamp(ROOT_HASH);
  process.env.FITX_ADMIN_PASSWORD_HASH = OPERATOR_HASH;
  assert.equal((await readWith(sessionRow({ stamp: rootStamp, operator: ROOT }))).result, null, "new FITX_ADMIN_PASSWORD_HASH");

  resetFakes();
  process.env.FITX_ADMIN_PASSWORD_HASH = ROOT_HASH;
  process.env.FITX_ADMIN_USERNAME = "new-owner";
  assert.equal((await readWith(sessionRow({ stamp: rootStamp, operator: ROOT }))).result, null, "renamed root");

  resetFakes();
  process.env.FITX_ADMIN_USERNAME = "test-owner";
  assert.ok((await readWith(sessionRow({ stamp: sessions.credentialStamp(OPERATOR_HASH), operator: AGENT }))).result);
  resetFakes();
  assert.equal((await readWith(sessionRow({ stamp: sessions.credentialStamp(OPERATOR_HASH), operator: { ...AGENT, is_active: false } }))).result, null, "switched off");
});

test("createAdminSession stores the token hash and stamp and sets the cookie with its flags", async () => {
  fake.handler = (call) => {
    if (call.table === "admin_operators") return { data: AGENT, error: null };
    if (call.table === "admin_web_sessions") return { data: { id: "new-session" }, error: null };
    return { data: null, error: null };
  };
  const result = await sessions.createAdminSession("a1", { ipKey: "k".repeat(43), userAgent: "Test browser" });
  assert.deepEqual(result, { ok: true, sessionId: "new-session" });
  const cookie = fake.cookieWrites[0];
  assert.equal(cookie.name, "__Host-fitx_admin");
  assert.deepEqual(cookie.options, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 43200 });
  const insert = tableCalls("admin_web_sessions")[0].ops.find(([op]) => op === "insert")[1];
  assert.equal(insert.token_hash, sessions.hashSessionToken(cookie.value));
  assert.equal(insert.credential_stamp, sessions.credentialStamp(OPERATOR_HASH));
  assert.equal(insert.operator_id, "a1");
});

test("an inactive operator gets no session", async () => {
  fake.handler = (call) => (call.table === "admin_operators" ? { data: { ...AGENT, is_active: false }, error: null } : { data: { id: "x" }, error: null });
  assert.deepEqual(await sessions.createAdminSession("a1", { ipKey: null, userAgent: null }), { ok: false });
  assert.equal(fake.cookieWrites.length, 0);
});

test("the Admin CSP uses the nonce, blocks framing and inline code, and allows Supabase only for media and uploads", () => {
  const csp = buildAdminCsp({ nonce: "abc123==", supabaseOrigin: "https://demo.supabase.co", isDev: false, upgradeInsecureRequests: true });
  assert.match(csp, /script-src 'self' 'nonce-abc123==' 'strict-dynamic'(;|$)/);
  assert.match(csp, /style-src 'self' 'nonce-abc123=='/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'(;|$)/);
  // Images also from the exercise catalogue's pinned GitHub source (originals not yet in FITX Storage), nothing else there.
  assert.match(csp, /img-src 'self' data: blob: https:\/\/demo\.supabase\.co https:\/\/raw\.githubusercontent\.com\/yuhonas\/free-exercise-db\/(;|$)/);
  assert.equal(csp.match(/githubusercontent/g)?.length, 1, "GitHub only in img-src");
  assert.match(csp, /media-src 'self' blob: https:\/\/demo\.supabase\.co(;|$)/);
  assert.match(csp, /connect-src 'self' https:\/\/demo\.supabase\.co(;|$)/);
  assert.doesNotMatch(csp, /google/);
  assert.match(csp, /upgrade-insecure-requests$/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});

test("development relaxes only what React's dev tools need, and plain HTTP skips the upgrade", () => {
  const csp = buildAdminCsp({ nonce: "n", supabaseOrigin: null, isDev: true, upgradeInsecureRequests: false });
  assert.match(csp, /script-src 'self' 'nonce-n' 'strict-dynamic' 'unsafe-eval'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /form-action 'self'(;|$)/);
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
});

test("only catalogue photos on the pinned GitHub source are previewed from outside FITX Storage", () => {
  const photo = `${EXERCISE_CATALOGUE_IMAGES}f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Pushups/0.jpg`;
  assert.equal(catalogueImageUrl(photo), photo);
  for (const other of [
    "https://raw.githubusercontent.com/someone-else/repo/main/a.jpg",
    `${EXERCISE_CATALOGUE_IMAGES}main/exercises/../../../x.jpg`,
    `${EXERCISE_CATALOGUE_IMAGES}main/exercises/Pushups/0.svg`,
    `${EXERCISE_CATALOGUE_IMAGES}main/a b.jpg`,
    `http://raw.githubusercontent.com/yuhonas/free-exercise-db/main/a.jpg`,
    null,
    42,
  ]) {
    assert.equal(catalogueImageUrl(other), null, String(other));
  }
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
