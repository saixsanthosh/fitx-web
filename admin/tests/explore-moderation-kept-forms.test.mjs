// Explore's own moderation forms keep what was typed when refused (the bug 63 mistake, found again in review): the
// reversible actions' reason and note (up to 1,000 characters) and Add moderator's username were plain server-action
// forms that redirected on every refusal, so React reset them. A refusal from the database (another moderator closed
// the report, the content is gone, the member has not joined) or an unknown username now comes back beside the
// buttons and the form keeps what was typed; an action that happened still goes back with a sealed result (BUGS.md 1).
// The forms with nothing typed in them (irreversible actions, suspend, lift, Remove as moderator) are unchanged.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv, tableCalls } from "./helpers/fakes.mjs";
import { sealedRedirect } from "./helpers/notices.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const explore = await importTypeScriptModule("src/app/(control)/explore/actions.ts", SESSION_STUBS);
const { withSubmitter } = await importTypeScriptModule("src/components/form-rules.ts");
const { keepTyped } = await importTypeScriptModule("src/components/content/keep-typed.ts", { react: "export const startTransition = (fn) => fn();" });

const OPERATOR = "00000000-0000-4000-8000-0000000000a1";
const REPORT = "bfc986a6-c220-41f1-916e-c02c397565d6";
const MEMBER = "4f1d2c3b-aaaa-4bbb-8ccc-0123456789ab";
const COMMUNITY = "6a0c1c4e-5b0e-4b8e-9a59-3f4d1e2a7c10";
const IDLE = { status: "idle" };
const NOTE = "Second report this week for the same links. The account was warned on 12 Nov; see the earlier report.";

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = { id: OPERATOR, username: "huntadmin", role: "admin", sessionId: "s1", isRoot: false, permissions: ["explore.view", "explore.moderate"] };
});

function form(entries) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

async function redirectOf(promise) {
  try {
    await promise;
  } catch (error) {
    if (error?.url) return error.url;
    throw error;
  }
  return null;
}

async function quietly(run) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    return { result: await run(), lines };
  } finally {
    console.error = original;
  }
}

const onReport = (action, extra = [["reason", "spam"]]) => form([["reportId", REPORT], ["action", action], ...extra, ["note", NOTE]]);
const refuseModeration = (error) => {
  fake.handler = (call) => (call.rpc === "fitx_admin_op_moderate" ? { data: null, error } : { data: null, error: null });
};

test("a reversible action refused before the database answers beside its buttons and sends nothing", async () => {
  assert.deepEqual(await explore.moderateKept(IDLE, onReport("delete_everything")), { status: "error", message: "Choose an action.", fieldErrors: undefined });
  assert.deepEqual(await explore.moderateKept(IDLE, onReport("hide", [["reason", "not_a_reason"]])), {
    status: "error", message: "Choose a reason from the list.", fieldErrors: { reason: "Choose a reason from the list." },
  });
  assert.deepEqual((await explore.moderateKept(IDLE, onReport("hide", []))).fieldErrors, { reason: "Choose a reason first." });
  assert.equal(fake.calls.length, 0, "nothing reached the database");
  // A form with no report or account is not a moderation form: the queue, from either action.
  assert.equal(await redirectOf(explore.moderateKept(IDLE, form([["action", "hide"], ["note", NOTE]]))), "/explore");
});

test("a refusal from the database comes back in Explore's words, so the note can be used again", async () => {
  for (const [action, error, message] of [
    ["claim", { code: "22023", message: "explore_report_closed" }, "This report is already closed."],
    ["hide", { code: "P0002", message: "explore_content_gone" }, "The content is gone (its owner deleted it, or it was removed). Dismiss the report instead."],
    ["limit", { code: "P0002", message: "explore_report_not_found" }, "That report no longer exists."],
    ["hide", { code: "42501", message: "Explore moderation permission required" }, "Your role can look at Explore but not change it."],
    ["dismiss", { code: "PGRST202", message: "Could not find the function" }, "This needs migration 20261124100020_fitx_admin_explore."],
  ]) {
    refuseModeration(error);
    assert.deepEqual(await explore.moderateKept(IDLE, onReport(action)), { status: "error", message, fieldErrors: undefined }, `${action}: ${error.message}`);
  }
  const sent = rpcCalls("fitx_admin_op_moderate").at(-1).args;
  assert.equal(sent.p_note, NOTE, "the note went as typed");
  assert.equal(sent.p_report_id, REPORT);
  refuseModeration({ code: "XX000", message: "boom" });
  const { result, lines } = await quietly(() => explore.moderateKept(IDLE, onReport("hide")));
  assert.deepEqual(result, { status: "error", message: "That did not complete. The server log has the details.", fieldErrors: undefined });
  assert.ok(lines.some((line) => line.includes("explore.moderate")), "an unknown refusal is logged");
});

test("an action that happened goes back to its page with a sealed result, as before", async () => {
  fake.handler = () => ({ data: { paths: [] }, error: null });
  const hidden = sealedRedirect(await redirectOf(explore.moderateKept(IDLE, onReport("hide"))), OPERATOR);
  assert.deepEqual(hidden, { path: `/explore/reports/${REPORT}`, notice: { code: "done_hide", count: null } });
  const sent = rpcCalls("fitx_admin_op_moderate").at(-1).args;
  assert.deepEqual([sent.p_operator_id, sent.p_action, sent.p_reason_code, sent.p_note, sent.p_user], [OPERATOR, "hide", "spam", NOTE, null]);
  const warned = sealedRedirect(await redirectOf(explore.moderateKept(IDLE, form([["userId", MEMBER.toUpperCase()], ["action", "warn"], ["reason", "harassment"], ["note", ""]]))), OPERATOR);
  assert.deepEqual(warned, { path: `/explore/accounts/${MEMBER}`, notice: { code: "done_warn", count: null } });
  assert.deepEqual([rpcCalls("fitx_admin_op_moderate").at(-1).args.p_user, rpcCalls("fitx_admin_op_moderate").at(-1).args.p_note], [MEMBER, null]);
});

test("the moderation forms with nothing typed in them still answer with a sealed result", async () => {
  refuseModeration({ code: "P0002", message: "explore_no_sanction" });
  const lift = sealedRedirect(await redirectOf(explore.moderate(form([["userId", MEMBER], ["action", "lift"], ["sanction", "dm"]]))), OPERATOR);
  assert.deepEqual(lift, { path: `/explore/accounts/${MEMBER}`, notice: { code: "no_sanction", count: null } });
  fake.handler = () => ({ data: { paths: [] }, error: null });
  const removed = sealedRedirect(await redirectOf(explore.moderate(form([["reportId", REPORT], ["action", "remove"], ["reason", "nudity"]]))), OPERATOR);
  assert.deepEqual(removed, { path: `/explore/reports/${REPORT}`, notice: { code: "done_remove", count: null } });
});

function profiles(found, roleError = null) {
  fake.handler = (call) => {
    if (call.table === "social_profiles") return found === "fails" ? { data: null, error: { code: "XX000", message: "boom" } } : { data: found ? { user_id: found } : null, error: null };
    if (call.rpc === "fitx_admin_op_set_community_role") return { data: null, error: roleError };
    return { data: null, error: null };
  };
}
const appoint = (username, extra = []) => form([["communityId", COMMUNITY], ["username", username], ...extra]);

test("Add moderator: a username no Explore profile has comes back marked, and nobody is appointed", async () => {
  profiles(null);
  assert.deepEqual(await explore.addModerator(IDLE, appoint("@No.Such.Member")), {
    status: "error", message: "No Explore profile has that username.", fieldErrors: { username: "No Explore profile has that username." },
  });
  assert.deepEqual(tableCalls("social_profiles")[0].ops.find(([op]) => op === "eq"), ["eq", "username", "no.such.member"]);
  // Not a username at all: refused without a lookup.
  assert.deepEqual((await explore.addModerator(IDLE, appoint("x y"))).fieldErrors, { username: "No Explore profile has that username." });
  assert.equal(tableCalls("social_profiles").length, 1);
  assert.equal(rpcCalls("fitx_admin_op_set_community_role").length, 0);
});

test("Add moderator: someone who has not joined, or is not an adult, is refused beside the button with the username marked", async () => {
  profiles(MEMBER, { code: "P0002", message: "explore_not_member" });
  assert.deepEqual(await explore.addModerator(IDLE, appoint("asha.local")), {
    status: "error", message: "Only accepted members can be moderators.", fieldErrors: { username: "Only accepted members can be moderators." },
  });
  profiles(MEMBER, { code: "22023", message: "explore_not_adult" });
  assert.deepEqual((await explore.addModerator(IDLE, appoint("asha.local"))).fieldErrors, { username: "Moderators must be 18 or over." });
  profiles(MEMBER, { code: "P0002", message: "explore_community_not_found" });
  const gone = await explore.addModerator(IDLE, appoint("asha.local"));
  assert.equal(gone.message, "That community no longer exists.");
  assert.equal(gone.fieldErrors?.username, undefined, "the username is not blamed");
});

test("Add moderator: a lookup that failed, or no server key, says so and does not blame the username", async () => {
  profiles("fails");
  const { result, lines } = await quietly(() => explore.addModerator(IDLE, appoint("asha.local")));
  assert.deepEqual(result, { status: "error", message: "That did not complete. The server log has the details.", fieldErrors: undefined });
  assert.ok(lines.some((line) => line.includes("data.explore_username")), "the failed lookup is logged");
  assert.equal(rpcCalls("fitx_admin_op_set_community_role").length, 0);
  delete process.env.SUPABASE_SECRET_KEY;
  assert.deepEqual(await explore.addModerator(IDLE, appoint("asha.local")), { status: "error", message: "Server data access is not configured.", fieldErrors: undefined });
});

test("Add moderator: an appointment goes back with a sealed result; Remove as moderator is unchanged", async () => {
  profiles(MEMBER);
  const added = sealedRedirect(await redirectOf(explore.addModerator(IDLE, appoint("Asha.Local", [["role", "member"]]))), OPERATOR);
  assert.deepEqual(added, { path: `/explore/communities/${COMMUNITY}`, notice: { code: "moderator_added", count: null } });
  assert.deepEqual(rpcCalls("fitx_admin_op_set_community_role").at(-1).args, { p_operator_id: OPERATOR, p_community: COMMUNITY, p_user: MEMBER, p_role: "moderator" }, "Add moderator only ever appoints");
  const removed = sealedRedirect(await redirectOf(explore.setCommunityRole(form([["communityId", COMMUNITY], ["userId", MEMBER], ["role", "member"]]))), OPERATOR);
  assert.deepEqual(removed, { path: `/explore/communities/${COMMUNITY}`, notice: { code: "moderator_removed", count: null } });
  assert.equal(rpcCalls("fitx_admin_op_set_community_role").at(-1).args.p_role, "member");
  const odd = sealedRedirect(await redirectOf(explore.setCommunityRole(form([["communityId", COMMUNITY], ["userId", MEMBER], ["role", "owner"]]))), OPERATOR);
  assert.deepEqual(odd.notice, { code: "invalid_role", count: null });
  assert.equal(await redirectOf(explore.addModerator(IDLE, form([["communityId", "nope"], ["username", "asha.local"]]))), "/explore/communities");
});

test("the pressed button goes with the form's data, as the browser sends it (the reversible actions read it)", () => {
  const sent = [];
  const submit = keepTyped((data) => sent.push(data));
  submit({ preventDefault() {}, currentTarget: undefined, nativeEvent: { submitter: { name: "action", value: "dismiss" } } });
  assert.equal(sent[0].get("action"), "dismiss");
  submit({ preventDefault() {}, currentTarget: undefined, nativeEvent: { submitter: { name: "", value: "hide" } } });
  submit({ preventDefault() {}, currentTarget: undefined, nativeEvent: { submitter: null } });
  submit({ preventDefault() {}, currentTarget: undefined });
  assert.deepEqual(sent.slice(1).map((data) => [...data.keys()]), [[], [], []], "a nameless button, or none, adds nothing");
  const data = new FormData();
  data.append("note", NOTE);
  assert.deepEqual([...withSubmitter(data, { name: "action", value: "hide" }).entries()], [["note", NOTE], ["action", "hide"]]);
  assert.deepEqual([...withSubmitter(new FormData(), { name: "action" }).entries()], [], "a button without a value adds nothing");
});

test("the field a refusal is about is drawn marked, focused or not", async () => {
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const marked = css.indexOf(':is(.stack-form, .member-form) :is(input, select, textarea)[aria-invalid="true"] { border-color: var(--red); }');
  assert.ok(marked > 0, "a refused field has a red border");
  assert.ok(marked > css.indexOf(":is(input, select, textarea):focus-visible {"), "after the focus rule (same weight), so it stays red while focused");
});

test("the reversible actions and Add moderator are client forms that keep what was typed", async () => {
  const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const actions = await read("components/explore/reversible-actions-form.tsx");
  assert.match(actions, /useActionState\(moderateKept, IDLE\)/);
  assert.match(actions, /onSubmit=\{keepTyped\(action\)\}/);
  assert.match(actions, /<FormResult id=\{resultId\} state=\{state\} pending=\{pending\} formRef=\{formRef\} \/>/);
  assert.match(actions, /<select name="reason" defaultValue=\{defaultReason \?\? "other"\} \{\.\.\.fieldAria\(state, "reason", resultId\)\}>/);
  assert.match(actions, /<textarea name="note" maxLength=\{1000\} rows=\{2\} \{\.\.\.fieldAria\(state, "note", resultId\)\} \/>/);
  // One submit button per action, each staying focusable and ignoring a press while one is sent.
  assert.match(actions, /type="submit"\s+name="action"\s+value=\{value\}/);
  assert.match(actions, /aria-disabled=\{pending\}\s+onClick=\{\(event\) => \{\s+if \(pending\) event\.preventDefault\(\);\s+else setPressed\(value\);/);
  const forms = await read("components/explore/moderation-forms.tsx");
  assert.match(forms, /<ReversibleActionsForm target=\{target\} actions=\{soft\} defaultReason=\{defaultReason\} allowClaim=\{allowClaim\} allowDismiss=\{allowDismiss\} \/>/);
  assert.doesNotMatch(forms, /<textarea|<input(?![^>]*type="hidden")/, "no plain moderation form has a typed field");
  const add = await read("components/explore/add-moderator-form.tsx");
  assert.match(add, /useActionState\(addModerator, IDLE\)/);
  assert.match(add, /onSubmit=\{keepTyped\(action\)\}/);
  assert.match(add, /<input name="username" required autoComplete="off" placeholder="name\.surname" \{\.\.\.fieldAria\(state, "username", resultId\)\} \/>/);
  assert.match(add, /<FormResult id=\{resultId\} state=\{state\} pending=\{pending\} formRef=\{formRef\} \/>/);
  const page = await read("app/(control)/explore/communities/[id]/page.tsx");
  assert.match(page, /\{moderator && <AddModeratorForm communityId=\{community\.id\} \/>\}/);
  assert.doesNotMatch(page, /name="username"/, "no plain form on the page takes a typed username");
});
