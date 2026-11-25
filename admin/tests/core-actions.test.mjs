// Admin-core server code with a fake Supabase: who may end whose sessions, what the Dashboard's recent
// activity leaves out, how pasted recipients are looked up and who may paste emails, the confirmation before
// a notice to everyone, the theme switch's session check, and the Users search that keeps emails out of
// URLs. Made-up names, IDs and addresses only.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv, tableCalls } from "./helpers/fakes.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const sessions = await importTypeScriptModule("src/lib/admin-session.ts", SESSION_STUBS);
const audit = await importTypeScriptModule("src/lib/data/audit.ts", SESSION_STUBS);
const notices = await importTypeScriptModule("src/lib/data/notifications.ts", SESSION_STUBS);
const noticeActions = await importTypeScriptModule("src/app/(control)/notifications/actions.ts", SESSION_STUBS);
const themeActions = await importTypeScriptModule("src/components/theme/theme-actions.ts", SESSION_STUBS);
const userActions = await importTypeScriptModule("src/app/(control)/users/actions.ts", SESSION_STUBS);
const peopleSearch = await importTypeScriptModule("src/lib/people-search.ts", SESSION_STUBS);
const { READ_ONLY_AUDIT_ACTIONS } = await importTypeScriptModule("src/lib/audit-catalog-core.ts");

const ROOT_ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ID = "00000000-0000-4000-8000-0000000000b2";
const ACCOUNT_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const ACCOUNT_B = "bbbbbbbb-0000-4000-8000-0000000000b2";

const superAdmin = { id: OTHER_ID, username: "deputy", role: "super_admin", sessionId: "s-own", isRoot: false, permissions: ["security.view", "access.manage", "audit.view", "notifications.send", "announcements.manage", "people.view"] };
const editor = { id: OTHER_ID, username: "editor", role: "content_editor", sessionId: "s-own", isRoot: false, permissions: ["notifications.send", "nutrition.manage"] };

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = superAdmin;
});

function form(entries) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

test("the sessions list says which sessions are the owner's, so the page can hide End for other operators", async () => {
  const recent = new Date().toISOString();
  fake.handler = (call) => (call.table === "admin_web_sessions"
    ? { data: [
      { id: "s-root", operator_id: ROOT_ID, created_at: recent, last_seen_at: recent, revoked_at: null, revoked_reason: null, user_agent: null, admin_operators: { username: "owner", is_root: true } },
      { id: "s-other", operator_id: "00000000-0000-4000-8000-0000000000c3", created_at: recent, last_seen_at: recent, revoked_at: null, revoked_reason: null, user_agent: null, admin_operators: [{ username: "support", is_root: false }] },
    ], error: null }
    : { data: null, error: null });
  const result = await sessions.listAdminSessions({ activeOnly: true, limit: 50 });
  assert.equal(result.state, "ready");
  assert.deepEqual(result.sessions.map((row) => [row.id, row.ownerIsRoot]), [["s-root", true], ["s-other", false]]);
  const [call] = tableCalls("admin_web_sessions");
  assert.match(call.ops.find((op) => op[0] === "select")[1], /admin_operators\(username,is_root\)/);
});

test("recent admin activity can leave out read-only views; the Audit log itself still has them", async () => {
  assert.deepEqual([...READ_ONLY_AUDIT_ACTIONS].sort(), ["support_request_read", "user_viewed", "users_listed"]);
  fake.handler = () => ({ data: [], error: null });
  const result = await audit.recentAuditEvents({ limit: 8, excludeActions: READ_ONLY_AUDIT_ACTIONS, permission: "audit.view" });
  assert.equal(result.state, "ready");
  const [call] = tableCalls("fitx_admin_audit_logs");
  assert.deepEqual(call.ops.find((op) => op[0] === "not"), ["not", "action", "in", "(users_listed,user_viewed,support_request_read)"]);
  resetFakes();
  fake.operator = superAdmin;
  fake.handler = () => ({ data: [], error: null });
  await audit.recentAuditEvents({ limit: 30, actions: ["admin_login_failed"], permission: "security.view" });
  assert.equal(tableCalls("fitx_admin_audit_logs")[0].ops.some((op) => op[0] === "not"), false);
});

test("pasted emails are looked up in one call and unknown ones are named", async () => {
  fake.handler = (call) => (call.rpc === "fitx_admin_find_users_by_emails" ? { data: [{ email: "asha@example.test", user_id: ACCOUNT_A }], error: null } : { data: null, error: null });
  const result = await notices.resolveRecipients({ ids: [ACCOUNT_B], emails: ["asha@example.test", "nobody@example.test"], invalid: [] });
  assert.deepEqual(result, { ok: true, ids: [ACCOUNT_B, ACCOUNT_A], unknown: ["nobody@example.test"] });
  assert.equal(rpcCalls("fitx_admin_find_users_by_emails").length, 1);
  assert.deepEqual(rpcCalls("fitx_admin_find_users_by_emails")[0].args, { p_emails: ["asha@example.test", "nobody@example.test"] });
  assert.equal(rpcCalls("fitx_admin_find_user_by_email").length, 0);
});

test("before the one-call lookup exists, emails fall back to one lookup each", async () => {
  fake.handler = (call) => {
    if (call.rpc === "fitx_admin_find_users_by_emails") return { data: null, error: { code: "PGRST202", message: "missing" } };
    if (call.rpc === "fitx_admin_find_user_by_email") return { data: call.args.p_email === "asha@example.test" ? [{ user_id: ACCOUNT_A }] : [], error: null };
    return { data: null, error: null };
  };
  const result = await notices.resolveRecipients({ ids: [], emails: ["asha@example.test", "nobody@example.test"], invalid: [] });
  assert.deepEqual(result, { ok: true, ids: [ACCOUNT_A], unknown: ["nobody@example.test"] });
  assert.equal(rpcCalls("fitx_admin_find_user_by_email").length, 2);
});

test("a role without people.view cannot look emails up, so it cannot learn which addresses have accounts", async () => {
  fake.operator = editor;
  fake.handler = () => ({ data: [{ email: "asha@example.test", user_id: ACCOUNT_A }], error: null });
  assert.deepEqual(await notices.resolveRecipients({ ids: [], emails: ["asha@example.test"], invalid: [] }), { ok: false, error: "forbidden" });
  const state = await noticeActions.sendNotification(null, form([["audience", "chosen"], ["recipients", "asha@example.test\nnobody@example.test"], ["title", "Your plan changed"], ["body", "We moved your rest day."], ["tone", "info"]]));
  assert.deepEqual(state, { error: "Your role can send to account IDs only." });
  assert.equal(fake.calls.length, 0, "nothing is looked up or sent");

  // Account IDs still work for that role.
  fake.handler = (call) => (call.rpc === "fitx_admin_op_send_notifications" ? { data: { sent: 1 }, error: null } : { data: null, error: null });
  const sent = await noticeActions.sendNotification(null, form([["audience", "chosen"], ["recipients", ACCOUNT_A], ["title", "Your plan changed"], ["body", "We moved your rest day."], ["tone", "info"]]));
  assert.deepEqual(sent, { sent: "Sent to 1 account." });
  assert.deepEqual(rpcCalls("fitx_admin_op_send_notifications")[0].args.p_user_ids, [ACCOUNT_A]);
});

test("a notice to everyone needs the confirmation box ticked before anything is saved", async () => {
  fake.handler = (call) => (call.rpc === "fitx_admin_op_save_announcement" ? { data: "11111111-0000-4000-8000-000000000001", error: null } : { data: null, error: null });
  const fields = [["audience", "everyone"], ["title", "Planned upgrade"], ["body", "FITX may be slow tonight."], ["tone", "info"]];
  assert.deepEqual(await noticeActions.sendNotification(null, form(fields)), { error: "Tick the confirmation box first." });
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(await noticeActions.sendNotification(null, form([...fields, ["confirm_everyone", "yes"]])), { sent: "Published to everyone signed in." });
  assert.equal(rpcCalls("fitx_admin_op_save_announcement").length, 1);
  assert.equal(rpcCalls("fitx_admin_op_set_announcement_status").length, 1);
});

test("the theme switch's Server Action needs a signed-in operator", async () => {
  fake.operator = null;
  await assert.rejects(themeActions.saveAdminTheme("dark"), /no operator/);
  assert.deepEqual(fake.cookieWrites, []);
  fake.operator = editor;
  await themeActions.saveAdminTheme("dark");
  assert.equal(fake.cookieWrites.length, 1);
  assert.equal(fake.cookieWrites[0].value, "dark");
});

async function redirectOf(promise) {
  try {
    await promise;
  } catch (error) {
    if (error.url) return error.url;
    throw error;
  }
  throw new Error("expected a redirect");
}

test("the Users search posts its text and comes back with an opaque token, never the email or phone in the URL", async () => {
  const email = "asha.k@example.test";
  const url = await redirectOf(userActions.searchUsers(form([["q", `  ${email} `], ["status", "suspended"], ["method", "myspace"], ["plan", "premium"]])));
  assert.doesNotMatch(url, /asha|example|%40|@/i);
  const params = new URL(url, "https://admin.invalid").searchParams;
  assert.deepEqual([...params.keys()], ["s", "status", "plan"]);
  assert.equal(params.get("status"), "suspended");
  assert.equal(peopleSearch.openPeopleSearch(params.get("s"), superAdmin.id), email);
  // Bound to the operator who searched, and to the 30 minutes after.
  assert.equal(peopleSearch.openPeopleSearch(params.get("s"), ROOT_ID), null);
  assert.equal(peopleSearch.openPeopleSearch(params.get("s"), superAdmin.id, Date.now() + peopleSearch.PEOPLE_SEARCH_TTL_MS + 1000), null);
  const phone = await redirectOf(userActions.searchUsers(form([["q", "+91 98123 45678"]])));
  assert.doesNotMatch(phone, /98123|45678/);
  assert.equal(await redirectOf(userActions.searchUsers(form([["q", "   "], ["plan", "free"]]))), "/users?plan=free");
});

test("a Users search token that was altered, made up or sealed under another key opens to nothing", () => {
  const token = peopleSearch.sealPeopleSearch("ben@example.test", OTHER_ID);
  const raw = Buffer.from(token, "base64url");
  raw[raw.length - 20] ^= 1;
  assert.equal(peopleSearch.openPeopleSearch(raw.toString("base64url"), OTHER_ID), null);
  assert.equal(peopleSearch.openPeopleSearch("not a token", OTHER_ID), null);
  assert.equal(peopleSearch.openPeopleSearch("AAAA", OTHER_ID), null);
  assert.equal(peopleSearch.openPeopleSearch("", OTHER_ID), null);
  setTestEnv({ SUPABASE_SECRET_KEY: "another-made-up-key" });
  assert.equal(peopleSearch.openPeopleSearch(token, OTHER_ID), null);
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal(peopleSearch.sealPeopleSearch("ben@example.test", OTHER_ID), null);
});

test("without the server key the Users search never puts the text in the URL (the list then says the key is missing)", async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  // Without the key neither the search nor a notice can be sealed: the list itself shows that data access is not configured.
  assert.equal(await redirectOf(userActions.searchUsers(form([["q", "ben@example.test"]]))), "/users");
  fake.operator = null;
  await assert.rejects(userActions.searchUsers(form([["q", "ben@example.test"]])), /no operator/);
});
