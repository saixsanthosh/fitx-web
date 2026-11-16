import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const audit = await importTypeScriptModule("src/lib/audit-catalog.ts");
const announcements = await importTypeScriptModule("src/lib/announcement-input.ts");
const support = await importTypeScriptModule("../src/components/support/support-rules.ts");
const { istInputToIso, isoToIstInput, istDateToIso, formatShortDay } = await importTypeScriptModule("src/lib/time.ts");

const migrationsDir = new URL("../../supabase/migrations/", import.meta.url);
const phase10 = (await readdir(migrationsDir)).filter((name) => name.startsWith("202611181800")).sort();
const phase10Sql = await Promise.all(phase10.map(async (name) => ({ name, sql: await readFile(new URL(name, migrationsDir), "utf8") })));

test("audit action and resource names fit fitx_admin_log_event's patterns", () => {
  for (const action of Object.keys(audit.AUDIT_ACTIONS)) assert.match(action, /^[a-z][a-z0-9_]{2,79}$/, action);
  for (const type of audit.AUDIT_RESOURCE_TYPES) assert.match(type, /^[a-z][a-z0-9_]{1,79}$/, type);
});

test("every action the migrations write is in the catalog, marked as written by the database", () => {
  const written = new Set();
  for (const { sql } of phase10Sql) {
    for (const match of sql.matchAll(/'((?:admin|user|support|announcement|exercise)_[a-z_]+)'/g)) {
      if (audit.isAuditAction(match[1])) written.add(match[1]);
    }
    for (const match of sql.matchAll(/values \(p_actor_id,\s*'([a-z_]+)'/g)) {
      assert.ok(audit.isAuditAction(match[1]), `${match[1]} is written by SQL but missing from the catalog`);
      written.add(match[1]);
    }
  }
  for (const action of ["admin_member_updated", "exercise_visibility_updated", "user_sessions_revoked", "support_request_updated", "support_reply_sent", "announcement_created", "announcement_published", "announcement_archived", "announcement_unpublished"]) {
    assert.ok(written.has(action), `${action} should be written by a migration`);
    assert.equal(audit.AUDIT_ACTIONS[action].source, "database", action);
  }
});

test("audit filters accept only known values and round-trip through the query string", () => {
  const filters = audit.parseAuditFilters({ action: "user_deleted", actor: " owner@example.com ", resource: "user", resource_id: "abc", from: "2026-11-01", to: "2026-11-17", page: "3" });
  assert.deepEqual(filters, { action: "user_deleted", actor: "owner@example.com", resourceType: "user", resourceId: "abc", from: "2026-11-01", to: "2026-11-17", page: 3 });
  assert.equal(audit.auditFilterQuery(filters, { page: 1 }), "?action=user_deleted&actor=owner%40example.com&resource=user&resource_id=abc&from=2026-11-01&to=2026-11-17");
  const junk = audit.parseAuditFilters({ action: "drop_table", resource: "profiles", from: "17/11/2026", page: "-4" });
  assert.deepEqual(junk, { action: null, actor: "", resourceType: null, resourceId: "", from: "", to: "", page: 1 });
  assert.equal(audit.auditFilterQuery(junk), "");
});

test("audit details read as before → after changes plus the other fields", () => {
  assert.equal(audit.summariseAuditDetails({ before: { status: "open", priority: "normal" }, after: { status: "resolved", priority: "normal" } }), "status: open → resolved");
  assert.equal(audit.summariseAuditDetails({ before: null, after: { role: "admin", is_active: true } }), "role: admin · is active: true");
  assert.equal(audit.summariseAuditDetails({ reason: "lost phone", sessions_revoked: 2 }), "reason: lost phone · sessions revoked: 2");
  assert.equal(audit.summariseAuditDetails(null), "");
  assert.equal(audit.auditActionLabel("user_deleted"), "Account deleted");
  assert.equal(audit.auditActionLabel("something_new"), "something new");
});

test("announcement links stay inside FITX or use https", () => {
  for (const url of ["/workouts", "/", "/help?from=x", "https://fitnessx.vercel.app/blog"]) assert.equal(announcements.isSafeAnnouncementLink(url), true, url);
  for (const url of ["//evil.example", "/\\evil.example", "http://plain.example", "javascript:alert(1)", "workouts", "/has space"]) {
    assert.equal(announcements.isSafeAnnouncementLink(url), false, url);
  }
});

test("announcement input is trimmed and checked like the database checks it", () => {
  const ok = announcements.validateAnnouncement({ title: "  New plans  ", body: "Try them.", tone: "success", linkUrl: "/workouts", linkLabel: "Open", startsAt: "2026-11-18T04:00:00.000Z", endsAt: null });
  assert.deepEqual(ok, { ok: true, value: { title: "New plans", body: "Try them.", tone: "success", linkUrl: "/workouts", linkLabel: "Open", startsAt: "2026-11-18T04:00:00.000Z", endsAt: null } });
  const base = { title: "Hello there", body: "Body", tone: "info", linkUrl: "", linkLabel: "", startsAt: null, endsAt: null };
  assert.equal(announcements.validateAnnouncement({ ...base, title: "Hi" }).ok, false);
  assert.equal(announcements.validateAnnouncement({ ...base, tone: "shout" }).ok, false);
  assert.equal(announcements.validateAnnouncement({ ...base, linkUrl: "/workouts" }).ok, false);
  assert.equal(announcements.validateAnnouncement({ ...base, linkUrl: "//evil.example", linkLabel: "Go" }).ok, false);
  assert.equal(announcements.validateAnnouncement({ ...base, body: "x".repeat(601) }).ok, false);
  assert.equal(announcements.validateAnnouncement({ ...base, startsAt: "2026-11-18T10:00:00Z", endsAt: "2026-11-18T09:00:00Z" }).ok, false);
  // Lengths are counted in characters, like Postgres char_length: two emoji are 2, not 4.
  assert.equal(announcements.validateAnnouncement({ ...base, title: "🎉🎉" }).ok, false);
  assert.equal(announcements.validateAnnouncement({ ...base, title: "🎉".repeat(120) }).ok, true);
  assert.equal(announcements.validateAnnouncement({ ...base, title: "🎉".repeat(121) }).ok, false);
  assert.equal(announcements.validateAnnouncement({ ...base, body: "Hi\u0000 there" }).value.body, "Hi there");
});

test("announcement status follows publication and its time window", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const status = (row) => announcements.announcementStatus({ startsAt: null, endsAt: null, ...row }, now).text;
  assert.equal(status({ status: "draft" }), "Draft");
  assert.equal(status({ status: "archived" }), "Archived");
  assert.equal(status({ status: "published" }), "Live");
  assert.equal(status({ status: "published", startsAt: "2026-11-19T00:00:00Z" }), "Scheduled");
  assert.equal(status({ status: "published", endsAt: "2026-11-18T11:59:00Z" }), "Ended");
});

test("Help requests from the customer app are validated before they reach the database", () => {
  const ok = support.validateSupportRequest({ category: "problem", subject: "  Timer   stops ", body: "It stops after a minute.\r\nEvery time.", pagePath: "/workouts/active?session=1" });
  assert.deepEqual(ok, { ok: true, value: { category: "problem", subject: "Timer stops", body: "It stops after a minute.\nEvery time.", pagePath: "/workouts/active" } });
  assert.equal(support.validateSupportRequest({ category: "billing", subject: "Hello", body: "Long enough body" }).ok, false);
  assert.equal(support.validateSupportRequest({ category: "question", subject: "Hi", body: "Long enough body" }).ok, false);
  assert.equal(support.validateSupportRequest({ category: "question", subject: "Hello", body: "short" }).ok, false);
  assert.equal(support.validateSupportRequest(null).ok, false);
  for (const path of ["//evil.example", "https://x.example", "/a\\b", 42]) assert.equal(support.safePagePath(path), null, String(path));
  const reply = support.validateSupportReply({ requestId: "9F1C2B3A-1111-4222-8333-444455556666", body: " thanks " });
  assert.deepEqual(reply, { ok: true, value: { requestId: "9f1c2b3a-1111-4222-8333-444455556666", body: "thanks" } });
  assert.equal(support.validateSupportReply({ requestId: "1", body: "x" }).ok, false);
  assert.equal(support.validateSupportReply({ requestId: "9f1c2b3a-1111-4222-8333-444455556666", body: "  " }).ok, false);
  // Lengths are counted in characters, like Postgres char_length, so the table checks never refuse
  // what these checks accepted. NUL, which Postgres text cannot hold, is removed.
  const request = { category: "question", body: "Long enough body" };
  assert.equal(support.characterCount("😀😀"), 2);
  assert.equal(support.validateSupportRequest({ ...request, subject: "😀😀" }).ok, false);
  assert.equal(support.validateSupportRequest({ ...request, subject: "😀".repeat(120) }).ok, true);
  assert.equal(support.validateSupportRequest({ ...request, subject: "😀".repeat(121) }).ok, false);
  assert.equal(support.validateSupportRequest({ ...request, subject: "Hello", body: "😀".repeat(9) }).ok, false);
  assert.equal(support.validateSupportRequest({ ...request, subject: "Hel\u0000lo" }).value.subject, "Hello");
  assert.equal(support.validateSupportReply({ requestId: "9f1c2b3a-1111-4222-8333-444455556666", body: "😀".repeat(4000) }).ok, true);
});

test("rate-limited support functions take the per-account lock before they count", () => {
  const sql = phase10Sql.find(({ name }) => name.endsWith("_fitx_support.sql")).sql;
  for (const fn of ["fitx_submit_support_request", "fitx_reply_support_request"]) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${fn}(`)).split("$function$;")[0];
    const lock = body.indexOf("pg_advisory_xact_lock(hashtextextended('fitx_support:' || uid::text, 0))");
    assert.ok(lock > 0, `${fn} must take the per-account lock`);
    assert.ok(lock < body.indexOf("count(*)"), `${fn} must take the lock before counting`);
    if (body.includes("for update")) assert.ok(lock < body.indexOf("for update"), `${fn} must take the lock before any row lock`);
  }
});

test("IST form values convert exactly", () => {
  assert.equal(istInputToIso("2026-11-18T09:30"), "2026-11-18T04:00:00.000Z");
  assert.equal(istInputToIso("2026-11-18 09:30"), null);
  assert.equal(istInputToIso(""), null);
  assert.equal(isoToIstInput("2026-11-18T04:00:00.000Z"), "2026-11-18T09:30");
  assert.equal(isoToIstInput(null), "");
  assert.equal(istDateToIso("2026-11-18"), "2026-11-17T18:30:00.000Z");
  assert.equal(istDateToIso("2026-11-18", { endOfDay: true }), "2026-11-18T18:30:00.000Z");
  assert.equal(istDateToIso("18-11-2026"), null);
  assert.equal(formatShortDay("2026-11-18"), "18 Nov");
});

test("Phase 10 migrations use the agreed prefix and lock down every privileged function", () => {
  assert.deepEqual(phase10, [
    "20261118180000_fitx_admin_control_plane.sql",
    "20261118180001_fitx_admin_roles.sql",
    "20261118180002_fitx_admin_audit_log.sql",
    "20261118180003_fitx_admin_metrics.sql",
    "20261118180004_fitx_admin_people.sql",
    "20261118180005_fitx_support.sql",
    "20261118180006_fitx_announcements.sql",
  ]);
  for (const { name, sql } of phase10Sql) {
    const functions = [...sql.matchAll(/create or replace function public\.([a-z_]+)\(([\s\S]*?)\)\s*returns[\s\S]*?\$function\$;|create or replace function public\.([a-z_]+)\(/g)];
    for (const block of sql.split(/(?=create or replace function )/).slice(1)) {
      const fn = block.match(/^create or replace function public\.([a-z_]+)/)?.[1];
      const header = block.slice(0, block.indexOf("as $"));
      assert.match(header, /set search_path = ''/, `${name}: ${fn} must pin search_path`);
      if (/security definer/.test(header)) {
        assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`), `${name}: ${fn} must revoke execute from public and anon`);
      }
      if (/p_actor_id/.test(header)) {
        assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`), `${name}: ${fn} trusts p_actor_id, so only service_role may run it`);
        assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`), `${name}: ${fn} needs a service_role grant`);
      }
    }
    assert.ok(functions.length > 0 || !/function/.test(sql), name);
    for (const table of sql.matchAll(/create table if not exists public\.([a-z_]+)/g)) {
      assert.match(sql, new RegExp(`alter table public\\.${table[1]} enable row level security`), `${name}: ${table[1]} needs RLS`);
    }
  }
});
