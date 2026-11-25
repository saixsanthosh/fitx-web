// Admin's notices come only from Admin's own actions (BUGS.md 1, admin-1; BRIEF-3 D9). A Server Action seals its
// result (a code, and a count it made itself) for the operator who acted (src/lib/notice.ts); a page shows its own
// fixed words for a result only from such a token, made in the last 10 minutes. Text, numbers and codes typed into a
// link show nothing. Refused forms (Explore's challenge, template and community forms, its reversible moderation
// actions and Add moderator, Settings) answer beside their button and keep what was typed (BUGS.md 63, admin-2), so
// their refusals never travel in the address either.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv } from "./helpers/fakes.mjs";
import { sealedRedirect } from "./helpers/notices.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const notice = await importTypeScriptModule("src/lib/notice.ts");
const explore = await importTypeScriptModule("src/app/(control)/explore/actions.ts", SESSION_STUBS);
const users = await importTypeScriptModule("src/app/(control)/users/actions.ts", SESSION_STUBS);
const settings = await importTypeScriptModule("src/app/(control)/settings/actions.ts", SESSION_STUBS);
const { fieldAria } = await importTypeScriptModule("src/components/form-rules.ts");

const OPERATOR = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b1";
const NOW = Date.parse("2026-11-26T06:00:00Z");
const IDLE = { status: "idle" };
const moderator = { id: OPERATOR, username: "huntadmin", role: "super_admin", sessionId: "s1", isRoot: false, permissions: ["explore.view", "explore.moderate", "people.view", "people.suspend", "settings.view", "settings.manage"] };

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = moderator;
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

test("a sealed result opens only for the operator it was made for, unchanged, within 10 minutes", () => {
  const token = notice.sealNotice("bulk_suspended", OPERATOR, { count: 2, now: NOW });
  assert.match(token, /^bulk_suspended\.2\.[0-9a-z]+\.[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(notice.openNotice(token, OPERATOR, NOW + 1000), { code: "bulk_suspended", count: 2 });
  assert.equal(notice.openNotice(token, OTHER, NOW), null, "another operator's link shows nothing");
  assert.equal(notice.openNotice(token, OPERATOR, NOW + notice.NOTICE_TTL_MS), null, "ten minutes later it shows nothing");
  const [code, count, expiry, tag] = token.split(".");
  const flipped = `${tag.slice(0, -1)}${tag.endsWith("A") ? "B" : "A"}`;
  for (const altered of [
    `bulk_partial.${count}.${expiry}.${tag}`,
    `${code}.500.${expiry}.${tag}`,
    `${code}..${expiry}.${tag}`,
    `${code}.${count}.${(Number.parseInt(expiry, 36) + 3_600_000).toString(36)}.${tag}`,
    `${code}.${count}.${expiry}.${flipped}`,
  ]) {
    assert.equal(notice.openNotice(altered, OPERATOR, NOW), null, altered);
  }
  const plain = notice.sealNotice("saved", OPERATOR, { now: NOW });
  assert.deepEqual(notice.openNotice(plain, OPERATOR, NOW), { code: "saved", count: null });
});

test("what a link can put in the address shows nothing: words, numbers, plain codes", () => {
  for (const value of [
    "saved", "invalid", "invalid_input", "bulk_suspended", "500", "constructor",
    "Your Admin session has ended. Sign in again at https://fitx-admin-login.example.net to keep your changes.",
    "", undefined, null, 42, ["saved"],
  ]) {
    assert.equal(notice.openNotice(value, OPERATOR, NOW), null, String(value));
  }
  assert.equal(notice.pageNotice(["saved", "invalid"], OPERATOR), null);
  const token = notice.sealNotice("saved", OPERATOR);
  assert.deepEqual(notice.pageNotice([token, "invalid"], OPERATOR), { code: "saved", count: null }, "a repeated parameter reads its first value");
  // Another server key (another deployment) and no key at all: nothing opens, nothing is sealed.
  setTestEnv({ SUPABASE_SECRET_KEY: "another-made-up-key" });
  assert.equal(notice.openNotice(token, OPERATOR), null);
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal(notice.sealNotice("saved", OPERATOR), null);
  assert.equal(notice.openNotice(token, OPERATOR), null);
  assert.equal(notice.noticeHref("/settings", "saved", OPERATOR), "/settings", "without the key the page opens with no notice");
});

test("codes and counts are checked before sealing", () => {
  for (const code of ["", "Saved", "has space", "x".repeat(49), "drop;table"]) assert.equal(notice.sealNotice(code, OPERATOR), null, code);
  for (const count of [-1, 1.5, Number.NaN, 1_000_000]) assert.equal(notice.sealNotice("bulk_suspended", OPERATOR, { count }), null, String(count));
  assert.equal(notice.sealNotice("saved", ""), null, "a notice is always someone's");
});

test("the address keeps the page's own query and fragment, and an old result is replaced", () => {
  const programmes = sealedRedirect(notice.noticeHref("/training?tab=programmes#push-pull-legs", "programme_draft", OPERATOR, { param: "state" }), OPERATOR, "state");
  assert.deepEqual(programmes, { path: "/training?tab=programmes#push-pull-legs", notice: { code: "programme_draft", count: null } });
  const href = notice.noticeHref("/users?status=suspended&notice=bulk_suspended.500.zzzz.AAAAAAAAAAAAAAAAAAAAAA", "none_selected", OPERATOR);
  assert.equal(new URL(href, "https://admin.invalid").searchParams.getAll("notice").length, 1);
  assert.deepEqual(sealedRedirect(href, OPERATOR), { path: "/users?status=suspended", notice: { code: "none_selected", count: null } });
});

test("a page shows only its own words: an unknown code, or none, shows nothing", () => {
  const table = { saved: "Saved." };
  assert.equal(notice.noticeWords(table, { code: "saved", count: null }), "Saved.");
  assert.equal(notice.noticeWords(table, { code: "constructor", count: null }), null);
  assert.equal(notice.noticeWords(table, { code: "deleted", count: null }), null);
  assert.equal(notice.noticeWords(table, null), null);
});

test("bulk suspension: the count shown is the action's own, sealed with its result", async () => {
  const ids = ["00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"];
  const url = await redirectOf(users.suspendSelected(form([...ids.map((id) => ["ids", id]), ["reason", "Spam accounts"], ["confirm", "yes"], ["return", "/users?status=active&count=500"]])));
  const result = sealedRedirect(url, OPERATOR);
  assert.deepEqual(result.notice, { code: "bulk_suspended", count: 2 });
  assert.equal(new URL(result.path, "https://admin.invalid").pathname, "/users");
  assert.equal(rpcCalls("fitx_admin_op_revoke_user_sessions").length, 2);
  // Refused before anything happens: no selection.
  const none = sealedRedirect(await redirectOf(users.suspendSelected(form([["reason", "Spam accounts"], ["confirm", "yes"]]))), OPERATOR);
  assert.deepEqual(none, { path: "/users", notice: { code: "none_selected", count: null } });
});

test("Explore actions go back with a sealed result, never with words in the address", async () => {
  const report = "bfc986a6-c220-41f1-916e-c02c397565d6";
  const url = await redirectOf(explore.moderate(form([["reportId", report], ["action", "no-such-action"]])));
  assert.deepEqual(sealedRedirect(url, OPERATOR), { path: `/explore/reports/${report}`, notice: { code: "invalid_action", count: null } });
  assert.doesNotMatch(url, /message=/);
});

const challenge = (entries = []) => form([
  ["title", "Local check invalid"], ["kind", "weekly"], ["metric", "workouts"], ["sport", ""], ["target", "5"], ["day", "2099-12-07"], ["community", ""], ...entries,
].filter(([key], index, all) => all.findLastIndex(([other]) => other === key) === index));

test("a refused challenge answers beside the form, names the field, and calls nothing (the form keeps what was typed)", async () => {
  const target = await explore.saveChallenge(IDLE, challenge([["target", "-5"]]));
  assert.deepEqual(target, {
    status: "error",
    message: "The target must be a number above 0 (up to 100,000), or empty.",
    fieldErrors: { target: "The target must be a number above 0 (up to 100,000), or empty." },
  });
  const week = await explore.saveChallenge(IDLE, challenge([["day", "2020-01-06"]]));
  assert.equal(week.status, "error");
  assert.equal(week.message, "That week or month is over. Choose this one or a later one.");
  assert.deepEqual(Object.keys(week.fieldErrors), ["day"]);
  const sport = await explore.saveChallenge(IDLE, challenge([["sport", "run"]]));
  assert.deepEqual(Object.keys(sport.fieldErrors), ["sport"]);
  assert.equal(fake.calls.length, 0, "nothing reached the database");
});

test("a challenge the database refuses comes back to the form in Explore's words; a saved one goes back with a sealed result", async () => {
  fake.handler = (call) => (call.rpc === "fitx_admin_op_save_challenge" ? { data: null, error: { code: "22023", message: "explore_invalid_window" } } : { data: null, error: null });
  const refused = await explore.saveChallenge(IDLE, challenge());
  assert.deepEqual(refused, { status: "error", message: "Choose a week or month that has not ended.", fieldErrors: { day: "Choose a week or month that has not ended." } });
  fake.handler = (call) => (call.rpc === "fitx_admin_op_save_challenge" ? { data: null, error: { code: "XX000", message: "boom" } } : { data: null, error: null });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  const failed = await explore.saveChallenge(IDLE, challenge()).finally(() => { console.error = original; });
  assert.deepEqual(failed, { status: "error", message: "That did not complete. The server log has the details.", fieldErrors: undefined });
  assert.ok(errors.some((line) => line.includes("explore.save_challenge")), "an unknown refusal is logged");
  fake.handler = () => ({ data: null, error: null });
  const saved = await redirectOf(explore.saveChallenge(IDLE, challenge()));
  assert.deepEqual(sealedRedirect(saved, OPERATOR), { path: "/explore/challenges", notice: { code: "challenge_saved", count: null } });
  assert.equal(rpcCalls("fitx_admin_op_save_challenge").at(-1).args.p_operator_id, OPERATOR);
});

test("templates and communities are refused the same way, field by field", async () => {
  const template = await explore.saveTemplate(IDLE, form([["title", ""], ["kind", "weekly"], ["metric", "workouts"], ["sport", ""], ["target", ""]]));
  assert.deepEqual(Object.keys(template.fieldErrors), ["title"]);
  assert.equal(template.message, "The title needs 1 to 80 characters.");
  const community = await explore.saveCommunity(IDLE, form([["name", "Morning runners"], ["slug", ""], ["description", "Runs before work."], ["visibility", "secret"]]));
  assert.deepEqual(community, { status: "error", message: "Choose public or private.", fieldErrors: { visibility: "Choose public or private." } });
  fake.handler = (call) => (call.rpc === "fitx_admin_op_save_community" ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: null, error: null });
  const taken = await explore.saveCommunity(IDLE, form([["name", "Morning runners"], ["slug", "morning-runners"], ["description", ""], ["visibility", "private"]]));
  assert.deepEqual(taken, { status: "error", message: "Another community already uses that address.", fieldErrors: { slug: "Another community already uses that address." } });
  fake.handler = () => ({ data: null, error: null });
  const created = sealedRedirect(await redirectOf(explore.saveCommunity(IDLE, form([["name", "Morning runners"], ["slug", ""], ["description", ""], ["visibility", "private"]]))), OPERATOR);
  assert.match(created.path, /^\/explore\/communities\/[0-9a-f-]{36}$/);
  assert.deepEqual(created.notice, { code: "saved", count: null });
});

test("Settings answers in its own save bar: a refusal names the field, a stale save says to reload, a save says so", async () => {
  const fields = [["support_email", "help@example.test"], ["instagram_url", "https://www.instagram.com/fitx/"], ["updated_at", "2026-11-25T10:00:00.000Z"]];
  const email = await settings.saveSettings(IDLE, form([...fields.filter(([key]) => key !== "support_email"), ["support_email", "nope"]]));
  assert.deepEqual(email, { status: "error", message: "Enter a support email address.", fieldErrors: { support_email: "Enter a support email address." } });
  const title = await settings.saveSettings(IDLE, form([...fields, ["maintenance_on", "on"], ["maintenance_title", "Up"], ["maintenance_body", "Slow tonight"]]));
  assert.deepEqual(Object.keys(title.fieldErrors), ["maintenance_title"]);
  assert.equal(fake.calls.length, 0, "nothing reached the database");
  fake.handler = (call) => (call.rpc === "fitx_admin_op_save_platform_settings" ? { data: null, error: { code: "40001", message: "changed" } } : { data: null, error: null });
  const stale = await settings.saveSettings(IDLE, form(fields));
  assert.equal(stale.status, "error");
  assert.match(stale.message, /^Someone saved these settings after you opened them\. Reload the page/);
  fake.handler = () => ({ data: null, error: null });
  assert.deepEqual(await settings.saveSettings(IDLE, form(fields)), { status: "saved", message: "Saved. The app picks it up within a minute." });
});

test("the field a refusal names is marked invalid and points at the result line; no other field is", () => {
  const state = { status: "error", message: "Choose public or private.", fieldErrors: { visibility: "Choose public or private." } };
  assert.deepEqual(fieldAria(state, "visibility", "r1"), { "aria-invalid": true, "aria-describedby": "r1" });
  assert.deepEqual(fieldAria(state, "name", "r1"), {});
  assert.deepEqual(fieldAria({ status: "saved", message: "Saved." }, "visibility", "r1"), {});
  assert.deepEqual(fieldAria(IDLE, "visibility", "r1"), {});
});

test("no page reads words, numbers or plain codes from the address, and no action writes them there", async () => {
  const root = new URL("../src/", import.meta.url);
  let pages = 0;
  for (const name of await readdir(root, { recursive: true })) {
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const source = await readFile(new URL(name, root), "utf8");
    assert.doesNotMatch(source, /[?&](notice|state|message|count)=(\$\{|[a-z_]+["`])/, `${name} builds a notice address by hand`);
    assert.doesNotMatch(source, /\b(params|query)\.(message|count)\b/, `${name} reads a message or count from the address`);
    assert.doesNotMatch(source, /firstParam\((\(await searchParams\)|params|query)\.(notice|state)\)|\b(params|query)\.(notice|state)\s*===/, `${name} reads a plain notice code`);
    if (name.endsWith("page.tsx") && /pageNotice\(/.test(source)) pages += 1;
  }
  assert.ok(pages >= 20, `${pages} pages read sealed results`);
  // The forms that keep what was typed: client forms on useActionState, submitting through keepTyped.
  for (const file of [
    "components/explore/challenge-forms.tsx", "components/explore/community-form.tsx", "components/explore/reversible-actions-form.tsx",
    "components/explore/add-moderator-form.tsx", "components/settings/settings-form.tsx",
  ]) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.match(source, /useActionState\(/, file);
    assert.match(source, /onSubmit=\{keepTyped\(action\)\}/, file);
    assert.match(source, /<FormResult /, file);
  }
});
