// The Admin forms that still lost what was typed when the server refused them (review finding admin-63-forms-still-reset;
// BUGS.md 63): the member page's Suspend access / Lift suspension, Sign out everywhere and Delete the account, the Users
// list's selection form (Suspend selected, Send notice to selected) and Access control's Add operator were plain
// server-action forms that redirected on every refusal, so React reset them. A mistyped confirmation emptied both the
// reason and the confirmation, a taken username emptied the username and the role, a press with no row ticked emptied
// the reason and the tick, and the message sat at the top of the page, away from the button. A refusal now comes back
// to the form, beside its button, naming the field it is about, and the form keeps what was typed (keepTyped) except a
// password; whatever changed something still goes back to its page with a sealed result (BUGS.md 1).
// Made-up IDs, names, addresses and passwords only.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv } from "./helpers/fakes.mjs";
import { serverActionForms } from "./helpers/jsx-scan.mjs";
import { sealedRedirect } from "./helpers/notices.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const users = await importTypeScriptModule("src/app/(control)/users/actions.ts", SESSION_STUBS);
const access = await importTypeScriptModule("src/app/(control)/access-control/actions.ts", SESSION_STUBS);
const { clearPasswords } = await importTypeScriptModule("src/components/form-rules.ts");

const OPERATOR = "00000000-0000-4000-8000-0000000000a1";
const MEMBER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OTHER = "bbbbbbbb-0000-4000-8000-0000000000b2";
const IDLE = { status: "idle" };
const REASON = "Spam links reported twice";
const PASSWORD = "made-up temporary passphrase";
const operator = {
  id: OPERATOR, username: "huntadmin", role: "super_admin", sessionId: "s1", isRoot: false,
  permissions: ["people.view", "people.suspend", "people.support", "people.delete", "notifications.send", "access.view", "access.manage"],
};

beforeEach(() => {
  resetFakes();
  setTestEnv({ FITX_ADMIN_USERNAME: "test-owner" });
  fake.operator = operator;
});

function form(entries) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

/** What an action for useActionState came to: the state it returned, or the address it redirected to. */
async function outcome(promise) {
  try {
    return { state: await promise };
  } catch (error) {
    if (error?.url) return { url: error.url };
    throw error;
  }
}

/** Runs with console.error and console.warn caught, so expected server log lines stay out of the test output. */
async function quietly(run) {
  const lines = [];
  const { error, warn } = console;
  console.error = (...args) => lines.push(args.join(" "));
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    return { result: await run(), lines };
  } finally {
    Object.assign(console, { error, warn });
  }
}

const refusal = (message, field) => ({ status: "error", message, fieldErrors: field ? { [field]: message } : undefined });
const audited = () => rpcCalls("fitx_admin_op_log_event").map((call) => call.args.p_action);
const authCalls = (method) => fake.calls.filter((call) => call.auth === method);
const onMember = (extra = []) => form([["userId", MEMBER], ["reason", REASON], ...extra]);

const WORDS = {
  reason: "Give a reason of 3 to 200 characters. It is kept in the audit log.",
  configuration: "Server data access is not configured.",
  auditFailed: "Nothing was changed because the audit log could not record the action.",
  auditMigration: "Nothing was changed: account actions are recorded first, and the audit function needs migration 20261121100030_fitx_admin_v2.",
  failed: "The change did not complete. The server log has the details.",
};

test("Suspend, Lift and Sign out everywhere: a reason that is not 3 to 200 characters comes back marked, and nothing is sent", async () => {
  for (const act of [users.suspendAccount, users.unsuspendAccount, users.revokeSessions]) {
    assert.deepEqual(await act(IDLE, form([["userId", MEMBER], ["reason", "  a   "]])), refusal(WORDS.reason, "reason"), act.name);
  }
  assert.equal(fake.calls.length, 0, "nothing reached Supabase");
  // A form that names no account is not one of these forms: back to the list, as before.
  assert.equal((await outcome(users.suspendAccount(IDLE, form([["userId", "nope"], ["reason", REASON]])))).url, "/users");
});

test("Suspend access: no server key, the audit log or Supabase refusing comes back beside the button, and nobody is suspended", async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  assert.deepEqual(await users.suspendAccount(IDLE, onMember()), refusal(WORDS.configuration));
  setTestEnv();
  fake.handler = (call) => (call.rpc === "fitx_admin_op_log_event" ? { data: null, error: { code: "XX000", message: "boom" } } : { data: null, error: null });
  assert.deepEqual((await quietly(() => users.suspendAccount(IDLE, onMember()))).result, refusal(WORDS.auditFailed));
  fake.handler = (call) => (call.rpc === "fitx_admin_op_log_event" ? { data: null, error: { code: "PGRST202", message: "missing" } } : { data: null, error: null });
  assert.deepEqual((await quietly(() => users.unsuspendAccount(IDLE, onMember()))).result, refusal(WORDS.auditMigration));
  assert.equal(authCalls("updateUserById").length, 0, "no ban was asked for without its audit row");
  fake.calls = [];
  fake.handler = (call) => (call.auth === "updateUserById" ? { data: null, error: { status: 500, code: "unexpected_failure" } } : { data: null, error: null });
  const { result, lines } = await quietly(() => users.suspendAccount(IDLE, onMember()));
  assert.deepEqual(result, refusal(WORDS.failed));
  assert.ok(lines.some((line) => line.includes("people.suspend")), "the refusal is logged");
  assert.deepEqual(audited(), ["user_suspend_requested", "user_suspend_failed"]);
  assert.equal(rpcCalls("fitx_admin_op_revoke_user_sessions").length, 0);
});

test("Suspend access and Lift suspension: what happened goes back to the member page with its result sealed", async () => {
  const suspended = sealedRedirect((await outcome(users.suspendAccount(IDLE, onMember()))).url, OPERATOR);
  assert.deepEqual(suspended, { path: `/users/${MEMBER}`, notice: { code: "suspended", count: null } });
  assert.deepEqual(authCalls("updateUserById")[0].args, [MEMBER, { ban_duration: "876000h" }]);
  assert.equal(rpcCalls("fitx_admin_op_revoke_user_sessions")[0].args.p_reason, `Suspended: ${REASON}`);
  const lifted = sealedRedirect((await outcome(users.unsuspendAccount(IDLE, onMember()))).url, OPERATOR);
  assert.deepEqual(lifted, { path: `/users/${MEMBER}`, notice: { code: "unsuspended", count: null } });
});

test("Sign out everywhere: the database function's refusals come back beside the button; signed out goes back sealed", async () => {
  const refuseWith = (error) => {
    fake.handler = (call) => (call.rpc === "fitx_admin_op_revoke_user_sessions" ? { data: null, error } : { data: null, error: null });
  };
  refuseWith({ code: "PGRST202", message: "missing" });
  assert.deepEqual(await users.revokeSessions(IDLE, onMember()), refusal("Signing out everywhere needs migration 20261118180004_fitx_admin_people."));
  refuseWith({ code: "42501", message: "permission denied for table sessions" });
  assert.deepEqual((await quietly(() => users.revokeSessions(IDLE, onMember()))).result, refusal("Supabase refused to end the sessions. The server log has the details."));
  refuseWith({ code: "XX000", message: "boom" });
  const { result, lines } = await quietly(() => users.revokeSessions(IDLE, onMember()));
  assert.deepEqual(result, refusal(WORDS.failed));
  assert.ok(lines.some((line) => line.includes("people.revoke_sessions")));
  fake.handler = () => ({ data: 2, error: null });
  const done = sealedRedirect((await outcome(users.revokeSessions(IDLE, onMember()))).url, OPERATOR);
  assert.deepEqual(done, { path: `/users/${MEMBER}`, notice: { code: "sessions_revoked", count: null } });
  assert.equal(rpcCalls("fitx_admin_op_revoke_user_sessions").at(-1).args.p_reason, REASON);
});

/** The fake Supabase for a deletion: the member exists with an email, and `billed` live subscriptions. */
function member({ billed = [], lookupFails = false } = {}) {
  fake.handler = (call) => {
    if (call.auth === "getUserById") return lookupFails ? { data: null, error: { status: 500 } } : { data: { user: { id: MEMBER, email: "member@example.test", phone: null } }, error: null };
    if (call.table === "billing_subscriptions") return { data: billed, error: null };
    if (call.op === "list") return { data: [], error: null };
    return { data: null, error: null };
  };
}
const deletion = (typed) => onMember([["confirmEmail", typed]]);

test("Delete the account: a confirmation that does not match comes back marked, with the account and its files untouched", async () => {
  member();
  assert.deepEqual(await users.deleteAccount(IDLE, deletion("member@example.tset")), refusal("What you typed does not match this account, so nothing was deleted.", "confirmEmail"));
  assert.deepEqual(await users.deleteAccount(IDLE, deletion("   ")), refusal("What you typed does not match this account, so nothing was deleted.", "confirmEmail"));
  assert.deepEqual((await users.deleteAccount(IDLE, form([["userId", MEMBER], ["reason", "x"], ["confirmEmail", "member@example.test"]]))).fieldErrors, { reason: WORDS.reason });
  assert.deepEqual(audited(), [], "no deletion was even requested");
  assert.equal(fake.calls.some((call) => call.storage || call.auth === "deleteUser"), false);
});

test("Delete the account: a subscription still billed, a failed lookup or audit row comes back beside the button, nothing deleted", async () => {
  member({ billed: [{ id: "made-up-subscription" }] });
  const billed = await users.deleteAccount(IDLE, deletion("Member@Example.test "));
  assert.equal(billed.message, "Nothing was deleted: Razorpay is still billing this account's FITX subscription. Ask the person to cancel it on the Subscription page in FITX, or cancel it in the Razorpay dashboard, then try again.");
  assert.equal(billed.fieldErrors, undefined, "nothing typed is blamed");
  member({ lookupFails: true });
  assert.deepEqual(await users.deleteAccount(IDLE, deletion("member@example.test")), refusal(WORDS.failed));
  member();
  const handler = fake.handler;
  fake.handler = (call) => (call.rpc === "fitx_admin_op_log_event" ? { data: null, error: { code: "XX000", message: "boom" } } : handler(call));
  assert.deepEqual((await quietly(() => users.deleteAccount(IDLE, deletion("member@example.test")))).result, refusal(WORDS.auditFailed));
  assert.equal(fake.calls.some((call) => call.storage || call.auth === "deleteUser"), false);
  member();
  const deleted = sealedRedirect((await outcome(users.deleteAccount(IDLE, deletion("member@example.test")))).url, OPERATOR);
  assert.deepEqual(deleted, { path: "/users", notice: { code: "deleted", count: null } });
  assert.equal(authCalls("deleteUser").length, 1);
});

const selection = (ids, extra = [["reason", REASON], ["confirm", "yes"]]) => form([...ids.map((id) => ["ids", id]), ["return", "/users?status=active"], ...extra]);

test("Suspend selected: refused before anything is sent, beside the buttons, with the reason or the tick marked", async () => {
  assert.deepEqual(await users.suspendSelected(IDLE, selection([])), refusal("Select at least one account."));
  const many = Array.from({ length: 51 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  assert.deepEqual(await users.suspendSelected(IDLE, selection(many)), refusal("Select at most 50 accounts at a time."));
  assert.deepEqual(await users.suspendSelected(IDLE, selection([MEMBER], [["reason", "  x  "], ["confirm", "yes"]])), refusal("Give a reason of 3 to 200 characters.", "reason"));
  assert.deepEqual(await users.suspendSelected(IDLE, selection([MEMBER], [["reason", REASON]])), refusal("Tick the confirmation box first.", "confirm"));
  assert.equal(fake.calls.length, 0, "nothing reached Supabase");
  delete process.env.SUPABASE_SECRET_KEY;
  assert.deepEqual(await users.suspendSelected(IDLE, selection([MEMBER])), refusal(WORDS.configuration));
});

test("Suspend selected: the audit log or Supabase refusing before any account is suspended keeps the form; after one, the list reloads sealed", async () => {
  fake.handler = (call) => (call.rpc === "fitx_admin_op_log_event" ? { data: null, error: { code: "XX000", message: "boom" } } : { data: null, error: null });
  assert.deepEqual((await quietly(() => users.suspendSelected(IDLE, selection([MEMBER, OTHER])))).result, refusal("No account was suspended because the audit log could not record the action."));
  fake.handler = (call) => (call.rpc === "fitx_admin_op_log_event" ? { data: null, error: { code: "PGRST202", message: "missing" } } : { data: null, error: null });
  assert.deepEqual((await quietly(() => users.suspendSelected(IDLE, selection([MEMBER])))).result, refusal("No account was suspended: account actions are recorded first, and the audit function needs migration 20261121100030_fitx_admin_v2."));
  assert.equal(authCalls("updateUserById").length, 0);

  // Supabase refuses every ban: nothing changed, so the form keeps the reason; the batch is still audited.
  fake.calls = [];
  fake.handler = (call) => (call.auth === "updateUserById" ? { data: null, error: { status: 500 } } : { data: null, error: null });
  assert.deepEqual((await quietly(() => users.suspendSelected(IDLE, selection([MEMBER, OTHER])))).result, refusal("No account was suspended: Supabase refused them all. The audit log lists each one."));
  assert.deepEqual(rpcCalls("fitx_admin_op_log_event").at(-1).args.p_details, { reason: REASON, selected: 2, suspended: 0, failed: 2 });

  // One suspended, then the audit log stops: the list reloads and says how far it got.
  let writes = 0;
  fake.handler = (call) => (call.rpc === "fitx_admin_op_log_event" && ++writes === 3 ? { data: null, error: { code: "XX000", message: "boom" } } : { data: null, error: null });
  const stopped = sealedRedirect((await quietly(() => outcome(users.suspendSelected(IDLE, selection([MEMBER, OTHER]))))).result.url, OPERATOR);
  assert.deepEqual(stopped, { path: "/users?status=active", notice: { code: "audit_failed", count: 1 } });
  // One refused by Supabase, one suspended: sealed, counted.
  fake.handler = (call) => (call.auth === "updateUserById" && call.args[0] === OTHER ? { data: null, error: { status: 500 } } : { data: null, error: null });
  const partial = sealedRedirect((await quietly(() => outcome(users.suspendSelected(IDLE, selection([MEMBER, OTHER]))))).result.url, OPERATOR);
  assert.deepEqual(partial, { path: "/users?status=active", notice: { code: "bulk_partial", count: 1 } });
});

test("the selection form's one action does what the pressed button says; a notice with no row ticked is refused beside it", async () => {
  assert.deepEqual(await users.noticeSelected(IDLE, selection([], [])), refusal("Select at least one account."));
  assert.deepEqual(await users.bulkUsers(IDLE, selection([], [["do", "notice"]])), refusal("Select at least one account."));
  assert.equal((await outcome(users.bulkUsers(IDLE, selection([MEMBER, OTHER.toUpperCase()], [["do", "notice"]])))).url, `/notifications?to=${MEMBER},${OTHER}`);
  // Suspend selected (and a form sent without a pressed button, as the form's own action) needs its reason and tick.
  assert.deepEqual(await users.bulkUsers(IDLE, selection([MEMBER], [["do", "suspend"], ["reason", REASON]])), refusal("Tick the confirmation box first.", "confirm"));
  assert.deepEqual(await users.bulkUsers(IDLE, selection([MEMBER], [["reason", REASON]])), refusal("Tick the confirmation box first.", "confirm"));
  assert.equal(fake.calls.length, 0);
  const suspended = sealedRedirect((await outcome(users.bulkUsers(IDLE, selection([MEMBER], [["do", "suspend"], ["reason", REASON], ["confirm", "yes"]])))).url, OPERATOR);
  assert.deepEqual(suspended.notice, { code: "bulk_suspended", count: 1 });
});

const newOperator = (username, extra = []) => form([["username", username], ["role", "support_agent"], ["password", PASSWORD], ...extra]);

test("Add operator: a username that breaks the rule, is reserved or is taken comes back marked, and nobody is added", async () => {
  assert.deepEqual(await access.addOperator(IDLE, newOperator("x")), refusal("Usernames are 3 to 32 characters: a to z, 0 to 9, dot, dash or underscore.", "username"));
  assert.deepEqual(await access.addOperator(IDLE, newOperator(" Test-Owner ")), refusal("That username is reserved.", "username"));
  assert.deepEqual(await access.addOperator(IDLE, form([["username", "local.agent"], ["role", "owner"], ["password", PASSWORD]])), refusal("Choose a role.", "role"));
  assert.deepEqual(await access.addOperator(IDLE, form([["username", "local.agent"], ["role", "viewer"], ["password", "short"]])), refusal("Passwords need at least 12 characters.", "password"));
  assert.equal(fake.calls.length, 0, "nothing reached the database");
  fake.handler = (call) => (call.rpc === "fitx_admin_op_create_operator" ? { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } } : { data: null, error: null });
  const taken = await access.addOperator(IDLE, newOperator("Local.Agent"));
  assert.deepEqual(taken, refusal("That username is taken.", "username"));
  assert.equal(rpcCalls("fitx_admin_op_create_operator")[0].args.p_username, "local.agent");
  assert.doesNotMatch(JSON.stringify(taken), /passphrase/, "a refusal never carries the password");
});

test("Add operator: a role without access, no server key or a failure says so without blaming a field", async () => {
  fake.operator = { ...operator, permissions: ["access.view"] };
  assert.deepEqual(await access.addOperator(IDLE, newOperator("local.agent")), refusal("Only a super-admin can change operators."));
  fake.operator = operator;
  delete process.env.SUPABASE_SECRET_KEY;
  assert.deepEqual(await access.addOperator(IDLE, newOperator("local.agent")), refusal("Server data access is not ready."));
  setTestEnv({ FITX_ADMIN_USERNAME: "test-owner" });
  fake.handler = (call) => (call.rpc === "fitx_admin_op_create_operator" ? { data: null, error: { code: "XX000", message: "boom" } } : { data: null, error: null });
  const { result, lines } = await quietly(() => access.addOperator(IDLE, newOperator("local.agent")));
  assert.deepEqual(result, refusal(WORDS.failed));
  assert.ok(lines.some((line) => line.includes("operators.create")));
});

test("Add operator: an operator added goes back to Access control with the result sealed in ?state=", async () => {
  fake.handler = (call) => (call.rpc === "fitx_admin_op_create_operator" ? { data: "00000000-0000-4000-8000-0000000000c3", error: null } : { data: null, error: null });
  const added = sealedRedirect((await outcome(access.addOperator(IDLE, newOperator("local.agent")))).url, OPERATOR, "state");
  assert.deepEqual(added, { path: "/access-control", notice: { code: "created", count: null } });
  const sent = rpcCalls("fitx_admin_op_create_operator")[0].args;
  assert.deepEqual([sent.p_operator_id, sent.p_username, sent.p_role], [OPERATOR, "local.agent", "support_agent"]);
  assert.match(sent.p_password_hash, /^scrypt:/, "only the hash is sent");
});

test("a refused form never keeps a password: clearPasswords empties the password fields only", () => {
  const password = { value: PASSWORD };
  const asked = [];
  const formLike = { querySelectorAll: (selector) => { asked.push(selector); return [password]; } };
  assert.equal(clearPasswords(formLike), true);
  assert.equal(password.value, "");
  assert.deepEqual(asked, ['input[type="password"]'], "only fields of type password are asked for");
  assert.equal(clearPasswords(formLike), false, "nothing left to empty");
  assert.equal(clearPasswords({ querySelectorAll: () => [{}] }), false, "an element without a value is left alone");
  assert.equal(clearPasswords(null), false);
  assert.equal(clearPasswords(undefined), false);
});

const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("the member page draws its typed forms as client forms that keep what was typed", async () => {
  const page = await read("app/(control)/users/[id]/page.tsx");
  assert.match(page, /<SuspensionForm userId=\{person\.id\} suspended=\{suspended\} \/>/);
  assert.match(page, /<SignOutEverywhereForm userId=\{person\.id\} \/>/);
  assert.match(page, /<DeleteAccountForm userId=\{person\.id\} confirmLabel=\{deleteCheck\.label\} expected=\{deleteCheck\.expected\} \/>/);
  assert.doesNotMatch(page, /name="reason"|name="confirmEmail"/, "no plain form on the page takes typed text");
  assert.match(page, /<form action=\{sendPasswordReset\}>/, "Send reset email has nothing typed in it and stays a plain form");
  assert.match(page, /noticeWords\(ACCOUNT_NOTICES, pageNotice\(notice, actor\.id\)\)/);
  const forms = await read("components/users/account-forms.tsx");
  assert.match(forms, /const \[state, action, pending\] = useActionState\(act, IDLE\);/);
  assert.match(forms, /<form ref=\{formRef\} action=\{action\} onSubmit=\{keepTyped\(action\)\} className="stack-form">/);
  assert.match(forms, /<FormResult id=\{resultId\} state=\{state\} pending=\{pending\} formRef=\{formRef\} \/>/);
  assert.match(forms, /<input name="reason" required minLength=\{3\} maxLength=\{200\} placeholder=\{placeholder\} \{\.\.\.fieldAria\(state, "reason", resultId\)\} \/>/);
  assert.match(forms, /<input name="confirmEmail" required autoComplete="off" placeholder=\{expected\} \{\.\.\.fieldAria\(state, "confirmEmail", resultId\)\} \/>/);
  // Suspend and Lift are separate forms (keys), each with its own answers; the buttons keep their names (admin-live).
  assert.match(forms, /<AccountForm key="lift" userId=\{userId\} act=\{unsuspendAccount\} label="Lift suspension" /);
  assert.match(forms, /<AccountForm key="suspend" userId=\{userId\} act=\{suspendAccount\} label="Suspend account" /);
  assert.match(forms, /act=\{revokeSessions\}\s+label="Sign out everywhere"/);
  assert.match(forms, /act=\{deleteAccount\}\s+label="Delete permanently"/);
});

test("the Users list's selection form keeps the reason, the tick and the ticked rows", async () => {
  const page = await read("app/(control)/users/page.tsx");
  assert.match(page, /\{bulk && result\.people\.length > 0 && <BulkUsersForm here=\{here\} canSuspend=\{canSuspend\} canNotify=\{canNotify\} max=\{BULK_SUSPEND_MAX\} \/>\}/);
  assert.doesNotMatch(page, /name="reason"|action=\{suspendSelected\}|formAction=/);
  const bulk = await read("components/users/bulk-users-form.tsx");
  assert.match(bulk, /useActionState\(bulkUsers, IDLE\)/);
  assert.match(bulk, /<form ref=\{formRef\} id="bulk-users" className=\{styles\.bulk\} action=\{action\} onSubmit=\{keepTyped\(action\)\} aria-label="Selected accounts">/);
  assert.match(bulk, /aria-label="Reason for suspending" \{\.\.\.fieldAria\(state, "reason", resultId\)\} \/>/);
  assert.match(bulk, /<input type="checkbox" name="confirm" value="yes" required \{\.\.\.fieldAria\(state, "confirm", resultId\)\} \/>Suspend and sign out/);
  assert.match(bulk, /name="do"\s+value=\{choice\}/);
  assert.match(bulk, /submit\("suspend", "danger-button", "Suspend selected"\)/);
  assert.match(bulk, /submit\("notice", "quiet-button", "Send notice to selected", true\)/, "a notice skips the browser's checks for the reason and tick");
  assert.match(bulk, /formNoValidate=\{skipChecks\}/);
  assert.match(bulk, /<FormResult id=\{resultId\} state=\{state\} pending=\{pending\} formRef=\{formRef\} \/>/);
  const actions = await read("app/(control)/users/actions.ts");
  assert.match(actions, /export async function noticeSelected\(_previous: FormState, formData: FormData\): Promise<FormState> \{\n  await requireAdmin\("notifications\.send"\);/);
  assert.match(actions, /if \(formData\.get\("do"\) === "notice"\) return noticeSelected\(previous, formData\);\n  return suspendSelected\(previous, formData\);/);
  const css = await read("components/users/users.module.css");
  assert.match(css, /\.bulkRow input\[type="text"\]\[aria-invalid="true"\] \{ border-color: var\(--red\); \}/);
});

test("Add operator keeps the username and role as typed, never the password", async () => {
  const page = await read("app/(control)/access-control/page.tsx");
  assert.match(page, /<AddOperatorForm minPasswordLength=\{MIN_PASSWORD_LENGTH\} \/>/);
  assert.doesNotMatch(page, /name="username"|action=\{addOperator\}/);
  assert.match(page, /noticeWords\(OPERATOR_NOTICES, pageNotice\(params\.state, actor\.id\)\)/);
  const add = await read("components/security/add-operator-form.tsx");
  assert.match(add, /useActionState\(addOperator, IDLE\)/);
  assert.match(add, /<form ref=\{formRef\} action=\{action\} onSubmit=\{keepTyped\(action\)\} className="member-form">/);
  for (const name of ["username", "role", "password"]) assert.match(add, new RegExp(`name="${name}"[^>]*\\{\\.\\.\\.fieldAria\\(state, "${name}", resultId\\)\\}`), name);
  assert.match(add, /useEffect\(\(\) => \{\n    if \(state\.status === "error"\) clearPasswords\(formRef\.current\);\n  \}, \[state\]\);/);
  assert.match(add, /<FormResult id=\{resultId\} state=\{state\} pending=\{pending\} formRef=\{formRef\} \/>/);
  // admin-live finds the form by these labels and its button.
  for (const label of ["Username", "Role", "Temporary password"]) assert.match(add, new RegExp(`<label>${label}<`), label);
  assert.match(add, />Add operator<\/BusyButton>/);
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.member-form > :is\(\.form-error, \.form-saved\) \{ grid-column: 1 \/ -1; \}/, "the answer has a row of its own");
});

test("no Admin form that a Server Action handles itself takes typed text, but the Users search", async () => {
  // The check that would have found these forms: React resets a form whose action is the Server Action itself, so a
  // refusal that redirects loses what was typed. Made-up shapes first: a plain form with a reason and a note is found;
  // a kept form (useActionState and keepTyped) and a plain form of choices are not.
  const plain = 'import { save } from "./actions"; export const F = () => <form action={save}><input name="reason" required /><textarea name="note" /><input type="password" name="secret" /><input type="hidden" name="id" /></form>;';
  assert.deepEqual(serverActionForms(plain, "plain.tsx").map((form) => [form.action, form.typed]), [["save", ["reason", "note"]]]);
  const kept = 'import { save } from "./actions"; export function F() { const [state, action] = useActionState(save, IDLE); return <form action={action} onSubmit={keepTyped(action)}><input name="reason" /></form>; }';
  assert.deepEqual(serverActionForms(kept, "kept.tsx"), []);
  const choices = 'import { save } from "@/app/(control)/things/actions"; export const F = () => <form action={save}><select name="role" /><input type="checkbox" name="confirm" /><input type="text" name="username" readOnly hidden /></form>;';
  assert.deepEqual(serverActionForms(choices, "choices.tsx").map((form) => form.typed), [[]]);
  // The member page's old Suspend / Lift form chose its action: found too.
  const either = 'import { lift, suspend } from "../actions"; export const F = ({ on }) => <form action={on ? lift : suspend}><label>Reason<input name="reason" /></label></form>;';
  assert.deepEqual(serverActionForms(either, "either.tsx").map((form) => [form.action, form.typed]), [["lift or suspend", ["reason"]]]);

  const SRC = new URL("../src/", import.meta.url);
  const typed = [];
  for (const name of await readdir(SRC, { recursive: true })) {
    if (!name.endsWith(".tsx")) continue;
    for (const form of serverActionForms(await readFile(new URL(name, SRC), "utf8"), name)) if (form.typed.length) typed.push(`${name}: ${form.action} (${form.typed.join(", ")})`);
  }
  // The Users search always goes to its results, with the text back in the box from its sealed token.
  assert.deepEqual(typed, ["app/(control)/users/page.tsx: searchUsers (q)"]);
});
