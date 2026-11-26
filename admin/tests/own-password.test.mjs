import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv, tableCalls } from "./helpers/fakes.mjs";
import { sealedRedirect } from "./helpers/notices.mjs";

// Made-up names and passwords only.
const CURRENT = "made-up current passphrase";
const NEXT = "made-up brand new passphrase";
const { hashPassword } = await importTypeScriptModule("src/lib/password.ts");
const ROOT_HASH = await hashPassword("made-up root passphrase");
const OPERATOR_HASH = await hashPassword(CURRENT);
setTestEnv({ FITX_ADMIN_USERNAME: "test-owner", FITX_ADMIN_PASSWORD_HASH: ROOT_HASH });
const operators = await importTypeScriptModule("src/lib/operators.ts", SESSION_STUBS);
const account = await importTypeScriptModule("src/app/(control)/account/actions.ts", SESSION_STUBS);

const ACTOR = { id: "00000000-0000-4000-8000-0000000000bb", username: "agent.one", role: "support_agent", isRoot: false, mustChangePassword: false, permissions: [] };
const ROW = { id: ACTOR.id, username: ACTOR.username, role: ACTOR.role, is_active: true, is_root: false, password_hash: OPERATOR_HASH, must_change_password: false };
const OLD_TOKEN = "B".repeat(43);

beforeEach(() => {
  resetFakes();
  setTestEnv({ FITX_ADMIN_USERNAME: "test-owner", FITX_ADMIN_PASSWORD_HASH: ROOT_HASH });
  fake.cookies.set("__Host-fitx_admin", OLD_TOKEN);
  fake.headers = new Headers({ "x-real-ip": "203.0.113.9", "user-agent": "Test browser" });
});

/** The login functions answer as given; inserting the new session fails when `sessionFails`. */
function database({ check = "ok", record = "recorded", sessionFails = false } = {}) {
  fake.handler = (call) => {
    if (call.rpc === "fitx_admin_login_check") return { data: check, error: null };
    if (call.rpc === "fitx_admin_login_record") return { data: record, error: null };
    if (call.rpc) return { data: 1, error: null };
    if (call.table === "admin_operators") return { data: ROW, error: null };
    if (call.table === "admin_web_sessions") {
      if (call.ops.some(([op]) => op === "insert")) return sessionFails ? { data: null, error: { code: "08006", message: "connection lost" } } : { data: { id: "s-new" }, error: null };
      return { data: [], error: null };
    }
    return { data: null, error: null };
  };
}

const change = (current, next = NEXT) => operators.changeOwnPassword(ACTOR, current, next, { headers: fake.headers });
const auditActions = () => rpcCalls("fitx_admin_op_log_event").map((call) => call.args.p_action);
const records = () => rpcCalls("fitx_admin_login_record").map((call) => call.args.p_succeeded);

test("a wrong current password counts against the username's sign-in limits and is audited", async () => {
  database();
  assert.deepEqual(await change("made-up wrong guess"), { ok: false, error: "wrong_password" });
  assert.equal(rpcCalls("fitx_admin_login_check")[0].args.p_username, "agent.one");
  assert.deepEqual(records(), [false]);
  assert.deepEqual(auditActions(), ["operator_password_change_failed"]);
  const event = rpcCalls("fitx_admin_op_log_event")[0].args;
  assert.equal(event.p_operator_id, ACTOR.id);
  assert.equal(event.p_resource_id, ACTOR.id);
  assert.deepEqual(event.p_details, { username: "agent.one", locked: false });
  assert.ok(!JSON.stringify(event).includes("wrong guess"), "the guess is never logged");
  assert.equal(rpcCalls("fitx_admin_op_set_operator_password").length, 0);
});

test("the guess that reaches the limit locks the username and audits the lock", async () => {
  database({ record: "locked_now" });
  assert.deepEqual(await change("made-up wrong guess"), { ok: false, error: "locked" });
  assert.deepEqual(auditActions(), ["operator_password_change_failed", "admin_login_locked"]);
  assert.equal(rpcCalls("fitx_admin_op_log_event")[0].args.p_details.locked, true);
});

test("while the username is locked the current password is not checked at all", async () => {
  for (const check of ["locked", "ip_limited"]) {
    resetFakes();
    database({ check });
    assert.deepEqual(await change(CURRENT), { ok: false, error: "locked" }, check);
    assert.equal(tableCalls("admin_operators").length, 0, check);
    assert.equal(rpcCalls("fitx_admin_login_record").length, 0, "a refused try never extends the lock");
    assert.equal(rpcCalls("fitx_admin_op_set_operator_password").length, 0);
  }
  resetFakes();
  fake.handler = (call) => (call.rpc === "fitx_admin_login_check" ? { data: null, error: { code: "PGRST202", message: "missing" } } : { data: null, error: null });
  assert.deepEqual(await change(CURRENT), { ok: false, error: "unavailable" }, "fails closed");
});

test("the right current password changes it and signs this browser in again", async () => {
  database();
  assert.deepEqual(await change(CURRENT), { ok: true, signedIn: true });
  assert.deepEqual(records(), [true]);
  assert.equal(rpcCalls("fitx_admin_op_set_operator_password")[0].args.p_must_change, false);
  assert.deepEqual(auditActions(), [], "operator_password_changed is written by the database function");
  const cookie = fake.cookieWrites.at(-1);
  assert.equal(cookie.name, "__Host-fitx_admin");
  assert.match(cookie.value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(cookie.value, OLD_TOKEN);
});

test("a changed password whose new session fails is reported as changed, and the ended cookie is cleared", async () => {
  database({ sessionFails: true });
  assert.deepEqual(await change(CURRENT), { ok: true, signedIn: false });
  assert.equal(rpcCalls("fitx_admin_op_set_operator_password").length, 1);
  const cleared = fake.cookieWrites.at(-1);
  assert.equal(cleared.value, "");
  assert.equal(cleared.options.secure, true);
  assert.equal(cleared.options.maxAge, 0);

  const action = await readFile(new URL("../src/app/(control)/account/actions.ts", import.meta.url), "utf8");
  // Sealed (lib/notice.ts) for the sign-in page, where nobody is signed in: a link cannot show it.
  assert.match(action, /if \(result\.ok && !result\.signedIn\) redirect\(noticeHref\("\/login", "password_changed", SIGN_IN_NOTICE, \{ param: "state" \}\)\)/);
  const login = await readFile(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
  assert.match(login, /pageNotice\(params\.state, SIGN_IN_NOTICE\)\?\.code === "password_changed" && <p[^>]*role="status">Password changed\./);
});

test("the root, a weak or unchanged new password never reach the limits", async () => {
  database();
  assert.deepEqual(await operators.changeOwnPassword({ ...ACTOR, isRoot: true }, CURRENT, NEXT, { headers: fake.headers }), { ok: false, error: "root_protected" });
  assert.deepEqual(await change(CURRENT, "short"), { ok: false, error: "weak_password" });
  assert.deepEqual(await change(NEXT, NEXT), { ok: false, error: "same_password" });
  assert.equal(rpcCalls("fitx_admin_login_check").length, 0);
});

test("a refusal the Account page has no words for reads as a failure, and is logged, never as no notice at all", async () => {
  // The database's refusals are mapped for every kind of operator change; a permission refusal comes back as
  // "forbidden", which the Account page has no words for (found by tests/notice-routes.test.mjs).
  database();
  const handler = fake.handler;
  fake.handler = (call) => (call.rpc === "fitx_admin_op_set_operator_password" ? { data: null, error: { code: "42501", message: "permission denied" } } : handler(call));
  fake.operator = ACTOR;
  const form = new FormData();
  form.set("current_password", CURRENT);
  form.set("next_password", NEXT);
  form.set("confirm_password", NEXT);
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  const url = await account.changePassword(form).then(() => null, (error) => error.url).finally(() => { console.warn = original; });
  assert.deepEqual(sealedRedirect(url, ACTOR.id, "state"), { path: "/account", notice: { code: "failed", count: null } });
  assert.ok(warnings.some((line) => line.includes("account.change_password") && line.includes("refused as forbidden")), warnings.join("\n"));
  // The refusals it has words for keep them.
  fake.handler = handler;
  const wrong = new FormData();
  wrong.set("current_password", "made-up wrong guess");
  wrong.set("next_password", NEXT);
  wrong.set("confirm_password", NEXT);
  const refused = await account.changePassword(wrong).then(() => null, (error) => error.url);
  assert.deepEqual(sealedRedirect(refused, ACTOR.id, "state").notice, { code: "wrong_password", count: null });
});
