import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv, tableCalls } from "./helpers/fakes.mjs";

// Made-up names and passwords only.
const ROOT_NAME = "test-owner";
const ROOT_PASSWORD = "made-up root passphrase";
const OPERATOR_PASSWORD = "made-up operator passphrase";

const { hashPassword } = await importTypeScriptModule("src/lib/password.ts");
const ROOT_HASH = await hashPassword(ROOT_PASSWORD);
const OPERATOR_HASH = await hashPassword(OPERATOR_PASSWORD);
setTestEnv({ FITX_ADMIN_USERNAME: ROOT_NAME, FITX_ADMIN_PASSWORD_HASH: ROOT_HASH });

const guard = await importTypeScriptModule("src/lib/login-guard.ts", SESSION_STUBS);
const actions = await importTypeScriptModule("src/app/login/actions.ts", SESSION_STUBS);
const v2Sql = await readFile(new URL("../../supabase/migrations/20261121100030_fitx_admin_v2.sql", import.meta.url), "utf8");

beforeEach(() => {
  resetFakes();
  setTestEnv({ FITX_ADMIN_USERNAME: ROOT_NAME, FITX_ADMIN_PASSWORD_HASH: ROOT_HASH });
});

test("the limits match fitx_admin_login_limits() in the migration", () => {
  const json = v2Sql.match(/fitx_admin_login_limits\(\)[\s\S]*?select '(\{[^']+\})'::jsonb/)?.[1];
  assert.ok(json, "fitx_admin_login_limits() not found");
  assert.deepEqual(JSON.parse(json), { ...guard.LOGIN_LIMITS });
  assert.deepEqual({ ...guard.LOGIN_LIMITS }, { userFailures: 5, userWindowMinutes: 15, lockMinutes: 15, ipAttempts: 20, ipWindowMinutes: 15 });
});

test("one message for every failure", () => {
  assert.equal(guard.LOGIN_FAILURE_MESSAGE, "Those sign-in details did not work. Wait a few minutes and try again.");
});

test("the client IP key prefers x-real-ip, then the first x-forwarded-for entry, and never holds the raw IP", () => {
  const key = (init) => guard.clientIpKey(new Headers(init));
  const real = key({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.1" });
  assert.equal(real, key({ "x-real-ip": "203.0.113.7" }));
  assert.equal(key({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }), key({ "x-real-ip": "198.51.100.1" }));
  assert.equal(key({}), key({ "x-real-ip": "unknown" }));
  assert.notEqual(real, key({ "x-real-ip": "203.0.113.8" }));
  assert.match(real, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!real.includes("203.0.113.7"));
  process.env.FITX_ADMIN_PASSWORD_HASH = OPERATOR_HASH;
  assert.notEqual(key({ "x-real-ip": "203.0.113.7" }), real, "keyed with FITX_ADMIN_PASSWORD_HASH");
});

test("failures take 400 to 700 ms in total", async () => {
  assert.equal(guard.failureDelayMs(() => 0), 400);
  assert.equal(guard.failureDelayMs(() => 1), 700);
  assert.equal(guard.failureDelayMs(() => 0.5), 550);
  for (let index = 0; index < 50; index += 1) {
    const delay = guard.failureDelayMs();
    assert.ok(delay >= 400 && delay <= 700, String(delay));
  }
  const started = Date.now();
  await guard.waitOutFailure(started - 1000, () => 0);
  assert.ok(Date.now() - started < 50, "no extra wait when the attempt already took long enough");
});

test("check and record map the database answers, and fail closed on errors", async () => {
  for (const answer of ["ok", "locked", "ip_limited"]) {
    fake.handler = () => ({ data: answer, error: null });
    assert.equal(await guard.checkLoginAllowed("someone", "key"), answer);
  }
  fake.handler = () => ({ data: "surprise", error: null });
  assert.equal(await guard.checkLoginAllowed("someone", "key"), "unavailable");
  fake.handler = () => ({ data: null, error: { code: "PGRST202", message: "missing" } });
  assert.equal(await guard.checkLoginAllowed("someone", "key"), "unavailable");
  assert.equal(await guard.recordLoginResult("someone", "key", false), "unavailable");
  fake.handler = () => ({ data: "locked_now", error: null });
  assert.equal(await guard.recordLoginResult("someone", "key", false), "locked_now");
  assert.deepEqual(rpcCalls("fitx_admin_login_record").at(-1).args, { p_username: "someone", p_ip_key: "key", p_succeeded: false });
});

/** A database where the login functions answer as given and admin_operators holds `operators`. */
function database({ check = "ok", record = "recorded", operators = [] } = {}) {
  fake.handler = (call) => {
    if (call.rpc === "fitx_admin_login_check") return { data: check, error: null };
    if (call.rpc === "fitx_admin_login_record") return { data: record, error: null };
    if (call.rpc === "fitx_admin_op_root_sign_in") return { data: "00000000-0000-4000-8000-0000000000aa", error: null };
    if (call.rpc) return { data: 1, error: null };
    if (call.table === "admin_operators") {
      const name = call.ops.find(([op, column]) => op === "eq" && column === "username")?.[2];
      const id = call.ops.find(([op, column]) => op === "eq" && column === "id")?.[2];
      const row = operators.find((operator) => operator.username === name || operator.id === id) ?? null;
      return { data: row, error: null };
    }
    if (call.table === "admin_web_sessions") return { data: { id: "00000000-0000-4000-8000-0000000000ss" }, error: null };
    if (call.table === "fitx_admin_audit_logs") return { data: [], error: null };
    return { data: null, error: null };
  };
}

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function signIn(fields) {
  const started = Date.now();
  try {
    const state = await actions.signIn(null, form(fields));
    return { state, elapsed: Date.now() - started };
  } catch (error) {
    if (error?.url) return { redirect: error.url, elapsed: Date.now() - started };
    throw error;
  }
}

const auditActions = () => rpcCalls("fitx_admin_op_log_event").map((call) => call.args.p_action);

test("an unknown username fails like a wrong password, after the delay, and is not audited", async () => {
  database();
  const result = await signIn({ username: "nobody-here", password: "made-up guess", next: "" });
  assert.deepEqual(result.state, { error: guard.LOGIN_FAILURE_MESSAGE, username: "nobody-here" });
  assert.ok(result.elapsed >= 395, String(result.elapsed));
  assert.equal(rpcCalls("fitx_admin_login_check").length, 1);
  assert.equal(rpcCalls("fitx_admin_login_record")[0].args.p_succeeded, false);
  assert.deepEqual(auditActions(), []);
  assert.equal(fake.cookieWrites.length, 0);
});

const ROOT_ROW = { id: "00000000-0000-4000-8000-0000000000aa", username: ROOT_NAME, role: "super_admin", is_active: true, is_root: true, password_hash: null, must_change_password: false };

test("the root signs in with the environment hash: row upserted, session row and cookie, then /overview", async () => {
  database({ operators: [ROOT_ROW] });
  fake.headers = new Headers({ "x-real-ip": "203.0.113.9", "user-agent": "Test browser" });
  const result = await signIn({ username: "  Test-Owner ", password: ROOT_PASSWORD, next: "" });
  assert.equal(result.redirect, "/overview");
  assert.deepEqual(rpcCalls("fitx_admin_op_root_sign_in")[0].args, { p_username: ROOT_NAME });
  assert.equal(rpcCalls("fitx_admin_login_record").at(-1).args.p_succeeded, true);
  const insert = tableCalls("admin_web_sessions").find((call) => call.ops.some(([op]) => op === "insert"));
  const row = insert.ops.find(([op]) => op === "insert")[1];
  assert.equal(row.operator_id, "00000000-0000-4000-8000-0000000000aa");
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  assert.match(row.credential_stamp, /^[0-9a-f]{16}$/);
  assert.equal(row.user_agent, "Test browser");
  assert.ok(!JSON.stringify(row).includes("203.0.113.9"), "no raw IP stored");
  const cookie = fake.cookieWrites.find((write) => write.name === "__Host-fitx_admin");
  assert.match(cookie.value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(cookie.value, row.token_hash, "the database keeps only the hash");
  assert.deepEqual(auditActions(), ["admin_login_succeeded"]);
});

test("next is used only when it is a console page", async () => {
  database({ operators: [ROOT_ROW] });
  const result = await signIn({ username: ROOT_NAME, password: ROOT_PASSWORD, next: "/audit" });
  assert.equal(result.redirect, "/audit", "next is used when it is a console page");
  const again = await signIn({ username: ROOT_NAME, password: ROOT_PASSWORD, next: "https://evil.example/" });
  assert.equal(again.redirect, "/overview", "any other next is ignored");
});

test("a wrong root password fails and is audited against the root; a fifth failure audits the lock", async () => {
  const root = ROOT_ROW;
  database({ operators: [root], record: "locked_now" });
  const result = await signIn({ username: ROOT_NAME, password: "made-up wrong guess", next: "" });
  assert.equal(result.state.error, guard.LOGIN_FAILURE_MESSAGE);
  assert.deepEqual(auditActions(), ["admin_login_failed", "admin_login_locked"]);
  const failed = rpcCalls("fitx_admin_op_log_event")[0].args;
  assert.equal(failed.p_operator_id, null, "a refused sign-in has no actor");
  assert.equal(failed.p_resource_id, root.id);
  assert.deepEqual(failed.p_details, { username: ROOT_NAME });
  assert.equal(rpcCalls("fitx_admin_op_root_sign_in").length, 0);
});

test("a locked username is refused without checking the password or opening a session", async () => {
  database({ check: "locked" });
  const result = await signIn({ username: ROOT_NAME, password: ROOT_PASSWORD, next: "" });
  assert.equal(result.state.error, guard.LOGIN_FAILURE_MESSAGE);
  assert.ok(result.elapsed >= 395);
  assert.equal(rpcCalls("fitx_admin_login_record").length, 0, "a refused attempt is not recorded again, so it never extends the lock");
  assert.equal(tableCalls("admin_operators").length, 0);
  assert.equal(fake.cookieWrites.length, 0);
});

test("an IP over its limit is refused and audited once per window", async () => {
  database({ check: "ip_limited" });
  const result = await signIn({ username: ROOT_NAME, password: ROOT_PASSWORD, next: "" });
  assert.equal(result.state.error, guard.LOGIN_FAILURE_MESSAGE);
  assert.deepEqual(auditActions(), ["admin_login_ip_limited"]);
  const details = rpcCalls("fitx_admin_op_log_event")[0].args.p_details;
  assert.match(details.ip_key, /^[A-Za-z0-9_-]{43}$/);

  resetFakes();
  database({ check: "ip_limited" });
  fake.handler = ((inner) => (call) => (call.table === "fitx_admin_audit_logs" ? { data: [{ id: 1 }], error: null } : inner(call)))(fake.handler);
  await signIn({ username: ROOT_NAME, password: ROOT_PASSWORD, next: "" });
  assert.deepEqual(auditActions(), [], "already audited in this window");
});

test("an operator signs in with their stored hash; a temporary password goes to /account", async () => {
  const operator = { id: "00000000-0000-4000-8000-0000000000bb", username: "agent.one", role: "support_agent", is_active: true, is_root: false, password_hash: OPERATOR_HASH, must_change_password: true };
  database({ operators: [operator] });
  const result = await signIn({ username: "agent.one", password: OPERATOR_PASSWORD, next: "/support" });
  assert.equal(result.redirect, "/account");
  assert.deepEqual(rpcCalls("fitx_admin_op_mark_signed_in")[0].args, { p_operator_id: operator.id });
});

test("an inactive operator cannot sign in, even with the right password", async () => {
  const operator = { id: "00000000-0000-4000-8000-0000000000cc", username: "former.agent", role: "admin", is_active: false, is_root: false, password_hash: OPERATOR_HASH, must_change_password: false };
  database({ operators: [operator] });
  const result = await signIn({ username: "former.agent", password: OPERATOR_PASSWORD, next: "" });
  assert.equal(result.state.error, guard.LOGIN_FAILURE_MESSAGE);
  assert.equal(fake.cookieWrites.length, 0);
});

test("without the root environment or the server key, every sign-in is refused", async () => {
  database();
  delete process.env.FITX_ADMIN_PASSWORD_HASH;
  let result = await signIn({ username: ROOT_NAME, password: ROOT_PASSWORD, next: "" });
  assert.equal(result.state.error, guard.LOGIN_FAILURE_MESSAGE);
  assert.equal(rpcCalls("fitx_admin_login_check").length, 0);

  setTestEnv({ FITX_ADMIN_PASSWORD_HASH: ROOT_HASH });
  delete process.env.SUPABASE_SECRET_KEY;
  result = await signIn({ username: ROOT_NAME, password: ROOT_PASSWORD, next: "" });
  assert.equal(result.state.error, guard.LOGIN_FAILURE_MESSAGE);
});

test("before migration 20261121100030 the check fails and sign-in is refused (fail closed)", async () => {
  fake.handler = (call) => (call.rpc === "fitx_admin_login_check" ? { data: null, error: { code: "PGRST202", message: "not found" } } : { data: null, error: null });
  const result = await signIn({ username: ROOT_NAME, password: ROOT_PASSWORD, next: "" });
  assert.equal(result.state.error, guard.LOGIN_FAILURE_MESSAGE);
  assert.equal(rpcCalls("fitx_admin_op_root_sign_in").length, 0);
});

test("sign out ends the session row, expires the cookie with its Secure flags, audits and goes to /login", async () => {
  fake.cookies.set("__Host-fitx_admin", "A".repeat(43));
  fake.handler = (call) => (call.table === "admin_web_sessions" ? { data: [{ id: "s1", operator_id: "o1" }], error: null } : { data: 1, error: null });
  await assert.rejects(actions.signOut(), (error) => error.url === "/login");
  const cleared = fake.cookieWrites.find((write) => write.name === "__Host-fitx_admin");
  assert.equal(cleared?.value, "", "the cookie is emptied");
  assert.equal(cleared.options.secure, true, "a __Host- cookie is only replaced by a Secure one");
  assert.equal(cleared.options.path, "/");
  assert.equal(cleared.options.maxAge, 0);
  assert.equal(cleared.options.expires.getTime(), 0);
  assert.equal(fake.cookies.get("__Host-fitx_admin"), "");
  const update = tableCalls("admin_web_sessions")[0];
  assert.ok(update.ops.some(([op, column]) => op === "eq" && column === "token_hash"));
  assert.deepEqual(auditActions(), ["admin_signed_out"]);
  assert.equal(rpcCalls("fitx_admin_op_log_event")[0].args.p_operator_id, "o1");
});
