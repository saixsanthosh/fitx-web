// The Explore section's pure rules: which actions fit which report, the queue filters, suspension lengths, the
// community and challenge forms (as the database checks them), challenge windows in India time, the meter's
// arithmetic, and a notice for every refusal the Explore migration can raise.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const rules = await importTypeScriptModule("src/lib/explore-rules.ts");
const notices = await importTypeScriptModule("src/components/explore/notices.ts");
const migration = await readFile(new URL("../../supabase/migrations/20261124100020_fitx_admin_explore.sql", import.meta.url), "utf8");

test("content actions fit their report: none on accounts and challenges, no Remove for communities, no Limit for messages", () => {
  assert.deepEqual(rules.contentActionsFor("post", "visible"), ["limit", "hide", "remove"]);
  assert.deepEqual(rules.contentActionsFor("comment", "visible"), ["limit", "hide", "remove"]);
  assert.deepEqual(rules.contentActionsFor("story", "visible"), ["limit", "hide", "remove"]);
  assert.deepEqual(rules.contentActionsFor("message", "visible"), ["hide", "remove"]);
  assert.deepEqual(rules.contentActionsFor("community", "visible"), ["limit", "hide"]);
  assert.deepEqual(rules.contentActionsFor("account", "visible"), []);
  assert.deepEqual(rules.contentActionsFor("challenge", "visible"), []);
  assert.deepEqual(rules.contentActionsFor("post", "hidden"), ["unhide", "remove"]);
  assert.deepEqual(rules.contentActionsFor("post", "limited"), ["unhide", "hide", "remove"]);
  assert.deepEqual(rules.contentActionsFor("community", "hidden"), ["unhide"]);
  assert.deepEqual(rules.contentActionsFor("post", "gone"), [], "gone content can only be dismissed");
  for (const action of rules.NEEDS_REASON) assert.ok(rules.MODERATION_ACTIONS.includes(action), action);
  for (const action of rules.IRREVERSIBLE) assert.ok(rules.MODERATION_ACTIONS.includes(action), action);
});

test("the buttons carry the names flows and owners rely on", () => {
  const names = rules.ACTION_LABELS;
  assert.equal(names.dismiss, "Dismiss");
  assert.equal(names.hide, "Hide");
  assert.equal(names.unhide, "Unhide");
  assert.equal(names.remove, "Remove");
  assert.equal(names.warn, "Warn");
  assert.equal(names.suspend, "Suspend from Explore");
  assert.equal(names.lift, "Lift suspension");
});

test("the action and reason lists match what the database accepts", () => {
  const actions = [...migration.matchAll(/'(dismiss|claim|limit|hide|unhide|remove|clear_avatar|clear_bio|warn|suspend|lift)'/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(actions)].sort(), [...rules.MODERATION_ACTIONS].sort());
  const reasons = migration.match(/reasons constant text\[\] := array\[([^\]]+)\]/);
  assert.ok(reasons);
  assert.deepEqual(reasons[1].split(",").map((entry) => entry.trim().replace(/'/g, "")), [...rules.REPORT_REASONS]);
  const sports = migration.match(/v_sport not in \(([^)]+)\)/);
  assert.deepEqual(sports[1].split(",").map((entry) => entry.trim().replace(/'/g, "")), [...rules.CHALLENGE_SPORTS]);
  for (const reason of rules.REPORT_REASONS) assert.ok(rules.REASON_LABELS[reason], reason);
});

test("the queue reads its filters and keeps them in links; waiting means open and in review", () => {
  assert.deepEqual(rules.parseQueueFilters({}), { status: "waiting", target: null, page: 1 });
  assert.deepEqual(rules.parseQueueFilters({ status: "dismissed", type: "story", page: "3" }), { status: "dismissed", target: "story", page: 3 });
  assert.deepEqual(rules.parseQueueFilters({ status: "evil", type: "x", page: "-1" }), { status: "waiting", target: null, page: 1 });
  assert.equal(rules.queueHref({ status: "waiting", target: null, page: 1 }), "/explore");
  assert.equal(rules.queueHref({ status: "all", target: "post", page: 2 }), "/explore?status=all&type=post&page=2");
  assert.deepEqual([...rules.statusesFor("waiting")], ["open", "reviewing"]);
  assert.deepEqual([...rules.statusesFor("all")], ["open", "reviewing", "actioned", "dismissed"]);
});

test("suspensions last 7 days, 30 days or until lifted; a lifted or ended one is not active", () => {
  const now = Date.parse("2026-11-24T10:00:00Z");
  assert.equal(rules.suspensionUntil("7d", now), "2026-12-01T10:00:00.000Z");
  assert.equal(rules.suspensionUntil("30d", now), "2026-12-24T10:00:00.000Z");
  assert.equal(rules.suspensionUntil("indefinite", now), null);
  assert.equal(rules.sanctionActive({ liftedAt: null, until: null }, now), true);
  assert.equal(rules.sanctionActive({ liftedAt: null, until: "2026-11-25T00:00:00Z" }, now), true);
  assert.equal(rules.sanctionActive({ liftedAt: null, until: "2026-11-23T00:00:00Z" }, now), false);
  assert.equal(rules.sanctionActive({ liftedAt: "2026-11-24T09:00:00Z", until: null }, now), false);
});

test("communities are checked as the database checks them, with an address made from the name", () => {
  assert.equal(rules.slugFromName("Morning Runners of Pune!"), "morning-runners-of-pune");
  assert.equal(rules.slugFromName("Café Strength"), "cafe-strength");
  const ok = rules.validateCommunity({ slug: "", name: " Morning runners ", description: "Runs before work.", visibility: "public" });
  assert.deepEqual(ok, { ok: true, value: { slug: "morning-runners", name: "Morning runners", description: "Runs before work.", visibility: "public" } });
  assert.equal(rules.validateCommunity({ slug: "x", name: "A", description: "", visibility: "public" }).ok, false);
  assert.equal(rules.validateCommunity({ slug: "good-slug", name: "", description: "", visibility: "public" }).ok, false);
  assert.equal(rules.validateCommunity({ slug: "good-slug", name: "A", description: "d".repeat(501), visibility: "public" }).ok, false);
  assert.equal(rules.validateCommunity({ slug: "good-slug", name: "A", description: "", visibility: "hidden" }).ok, false);
  assert.equal(rules.validateCommunity({ slug: "-bad", name: "A", description: "", visibility: "private" }).ok, false);
  assert.equal(rules.coverPath("00000000-0000-4000-8000-000000000001"), "communities/00000000-0000-4000-8000-000000000001/cover.webp");
  assert.match(migration, /p_cover_path <> 'communities\/' \|\| v_id::text \|\| '\/cover\.webp'/);
});

test("challenge windows are the IST week from Monday or the IST month from the 1st (O6)", () => {
  // 25 November 2026 is a Wednesday; its week starts Monday 23 November 00:00 IST = 22 November 18:30 UTC.
  assert.deepEqual(rules.challengeWindow("weekly", "2026-11-25"), { startsAt: "2026-11-22T18:30:00.000Z", endsAt: "2026-11-29T18:30:00.000Z" });
  assert.deepEqual(rules.challengeWindow("weekly", "2026-11-23"), { startsAt: "2026-11-22T18:30:00.000Z", endsAt: "2026-11-29T18:30:00.000Z" });
  assert.deepEqual(rules.challengeWindow("weekly", "2026-11-29"), { startsAt: "2026-11-22T18:30:00.000Z", endsAt: "2026-11-29T18:30:00.000Z" }, "Sunday ends the week");
  assert.deepEqual(rules.challengeWindow("monthly", "2026-12-31"), { startsAt: "2026-11-30T18:30:00.000Z", endsAt: "2026-12-31T18:30:00.000Z" });
  assert.deepEqual(rules.challengeWindow("monthly", "2027-02-10"), { startsAt: "2027-01-31T18:30:00.000Z", endsAt: "2027-02-28T18:30:00.000Z" });
  assert.equal(rules.challengeWindow("weekly", "2026-02-30"), null);
  assert.equal(rules.challengeWindow("weekly", "soon"), null);
  assert.equal(rules.istToday(Date.parse("2026-11-24T19:00:00Z")), "2026-11-25", "after 18:30 UTC it is the next day in India");
});

test("challenge and template forms: titles, metrics, sports only for distance and minutes, targets, and windows not over", () => {
  const now = Date.parse("2026-11-25T06:00:00Z");
  const base = { kind: "weekly", title: " Five workouts ", metric: "workouts", sport: "", target: "5", day: "2026-11-25", communityId: "" };
  const ok = rules.validateChallenge(base, now);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { kind: "weekly", title: "Five workouts", metric: "workouts", sport: null, target: 5, startsAt: "2026-11-22T18:30:00.000Z", endsAt: "2026-11-29T18:30:00.000Z", communityId: null });
  assert.equal(rules.validateChallenge({ ...base, sport: "run" }, now).ok, false, "a sport needs distance or minutes");
  assert.equal(rules.validateChallenge({ ...base, metric: "distance_km", sport: "run" }, now).value.sport, "run");
  assert.equal(rules.validateChallenge({ ...base, metric: "distance_km", sport: "swim" }, now).ok, false);
  assert.equal(rules.validateChallenge({ ...base, target: "0" }, now).ok, false);
  assert.equal(rules.validateChallenge({ ...base, target: "" }, now).value.target, null);
  assert.equal(rules.validateChallenge({ ...base, day: "2026-11-10" }, now).ok, false, "a week that is over");
  assert.equal(rules.validateChallenge({ ...base, title: "" }, now).ok, false);
  assert.equal(rules.validateChallenge({ ...base, metric: "steps" }, now).ok, false);
  assert.equal(rules.validateChallenge({ ...base, communityId: "not-an-id" }, now).ok, false);
  assert.equal(rules.validateChallenge({ ...base, communityId: "00000000-0000-4000-8000-0000000000AB" }, now).value.communityId, "00000000-0000-4000-8000-0000000000ab");
  const template = rules.validateTemplate({ kind: "monthly", title: "Run 50 km", metric: "distance_km", sport: "run", target: "50", active: true });
  assert.deepEqual(template.value, { kind: "monthly", title: "Run 50 km", metric: "distance_km", sport: "run", target: 50, active: true });
  assert.equal(rules.validateTemplate({ kind: "daily", title: "x", metric: "workouts", sport: "", target: "", active: true }).ok, false);
});

test("the challenge phase and window text read in India time", () => {
  const now = Date.parse("2026-11-25T06:00:00Z");
  const running = { startsAt: "2026-11-22T18:30:00.000Z", endsAt: "2026-11-29T18:30:00.000Z", closedAt: null };
  assert.equal(rules.challengePhase(running, now), "running");
  assert.equal(rules.challengePhase({ ...running, startsAt: "2026-11-29T18:30:00.000Z", endsAt: "2026-12-06T18:30:00.000Z" }, now), "upcoming");
  assert.equal(rules.challengePhase({ ...running, endsAt: "2026-11-24T00:00:00.000Z" }, now), "ending");
  assert.equal(rules.challengePhase({ ...running, closedAt: "2026-11-25T00:00:00Z" }, now), "closed");
  assert.equal(rules.windowText(running.startsAt, running.endsAt), "Mon 23 Nov to Mon 30 Nov");
});

test("the meter: bytes in plain words, shares only of known amounts, and its tones", () => {
  assert.equal(rules.formatBytes(null), "Not known");
  assert.equal(rules.formatBytes(512), "512 B");
  assert.equal(rules.formatBytes(51200), "50 KB");
  assert.equal(rules.formatBytes(3_565_158), "3.4 MB");
  assert.equal(rules.formatBytes(471859200), "450 MB");
  assert.equal(rules.formatBytes(1024 ** 3), "1 GB");
  assert.equal(rules.share(null, 10), null, "unknown is never 0");
  assert.equal(rules.share(5, null), null);
  assert.equal(rules.share(5, 10), 0.5);
  assert.equal(rules.meterTone(null), "neutral");
  assert.equal(rules.meterTone(0.5), "good");
  assert.equal(rules.meterTone(0.75), "warn");
  assert.equal(rules.meterTone(0.95), "danger");
  assert.equal(rules.FREE_PLAN.storageBytes, 1024 ** 3);
  assert.equal(rules.FREE_PLAN.databaseBytes, 500 * 1024 ** 2);
});

test("every refusal the migration raises has words on the screen, and so does every action's success", () => {
  const raised = [...new Set([...migration.matchAll(/message = 'explore_([a-z_]+)'/g)].map((match) => match[1]))];
  assert.ok(raised.length >= 20, String(raised.length));
  for (const key of raised) {
    assert.equal(rules.moderationNotice({ code: "22023", message: `explore_${key}` }), key);
    assert.ok(notices.exploreNotice(key), `no words for ${key}`);
    assert.equal(notices.exploreNotice(key).tone, "error", key);
  }
  for (const action of rules.MODERATION_ACTIONS) assert.equal(notices.exploreNotice(`done_${action}`)?.tone, "success", action);
  assert.equal(rules.moderationNotice({ code: "42501", message: "Explore moderation permission required" }), "forbidden");
  assert.equal(rules.moderationNotice({ code: "23505", message: "duplicate key" }), "slug_taken");
  assert.equal(rules.moderationNotice({ code: "XX000", message: "boom" }), "failed");
  assert.equal(rules.moderationNotice({ code: "P0001", message: "explore_hide" }), "failed", "only the codes the functions use are trusted");
  // Words come only from the code: there is no code that shows text from the address (BUGS.md 1).
  assert.equal(notices.exploreNotice("invalid_input"), null);
  assert.equal(notices.exploreNotice("constructor"), null);
  assert.equal(notices.exploreNotice("nonsense"), null);
  assert.equal(notices.exploreNotice(""), null);
});
