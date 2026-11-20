// Runs every repo migration on a throwaway local Postgres (the Supabase stand-in in tests/support, no network,
// no real data) and checks 20261121100033_fitx_admin_ops: platform settings (everyone reads, only an operator
// with settings.manage writes, audited, stale saves refused), targeted notices (only the recipient reads and
// dismisses, a dismissal cannot be undone), the support inbox (complaints, unread until read or answered),
// account search v2 (phone, sign-in methods, status and plan filters) and the security summary. It then runs
// the migration a second time. Skipped when the Postgres binaries are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";

const MIGRATION = path.join(MIGRATIONS_DIR, "20261121100033_fitx_admin_ops.sql");
const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const C = "cccccccc-0000-4000-8000-0000000000c3";
const asA = { role: "authenticated", sub: A };
const asB = { role: "authenticated", sub: B };
const anon = { role: "anon" };
const OWNER = "11111111-0000-4000-8000-000000000001";
const EDITOR = "22222222-0000-4000-8000-000000000002";
const VIEWER = "33333333-0000-4000-8000-000000000003";
const HASH = `scrypt:32768:8:1:${"A".repeat(22)}:${"B".repeat(86)}`;

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

describe("admin ops migration", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const errorOf = (sql, options) => {
    const result = pg.run(sql, options);
    assert.equal(result.ok, false, `expected an error from: ${sql}`);
    return result.stderr;
  };

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`
      insert into auth.users (id, email, phone, raw_user_meta_data, raw_app_meta_data, email_confirmed_at, created_at) values
        ('${A}', 'asha@example.test', null, '{"full_name":"Asha Rao"}', '{"providers":["google"]}', now(), now() - interval '3 days'),
        ('${B}', 'ben@example.test', '919812345678', '{}', '{"providers":["email"]}', now(), now() - interval '2 days'),
        ('${C}', null, '919800011122', '{}', '{"providers":["phone"]}', null, now() - interval '1 day');
      insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values
        ('g-a', '${A}', '{}', 'google', now(), now()), ('e-a', '${A}', '{}', 'email', now(), now());
      update auth.users set banned_until = now() + interval '100 years' where id = '${B}';
      insert into public.admin_operators (id, username, role, is_root, password_hash) values
        ('${OWNER}', 'owner', 'super_admin', true, null),
        ('${EDITOR}', 'editor', 'content_editor', false, '${HASH}'),
        ('${VIEWER}', 'viewer', 'viewer', false, '${HASH}');
    `);
  });

  after(() => pg?.stop());

  test("platform settings: everyone reads the one row, only settings.manage saves, and stale saves are refused", () => {
    assert.deepEqual(pg.json(`select to_json(array(select id from public.platform_settings))`, anon), [1]);
    assert.match(errorOf(`select updated_by_operator_id from public.platform_settings`, anon), /permission denied/);
    assert.match(errorOf(`update public.platform_settings set features = '{}'`, asA), /permission denied/);
    assert.match(errorOf(`select public.fitx_admin_op_save_platform_settings('${OWNER}', '{}', null, '{}')`, asA), /permission denied/);
    assert.match(errorOf(`select public.fitx_admin_op_save_platform_settings('${EDITOR}', '{}', null, '{}')`), /Settings permission required/);
    assert.match(errorOf(`select public.fitx_admin_op_save_platform_settings('${OWNER}', '{"ai_coach":"no"}', null, '{}')`), /Invalid feature switches/);
    assert.match(errorOf(`select public.fitx_admin_op_save_platform_settings('${OWNER}', '{"payments":false}', null, '{}')`), /Invalid feature switches/);
    assert.match(errorOf(`select public.fitx_admin_op_save_platform_settings('${OWNER}', '{}', '{"title":"Up","body":"x","startsAt":"2026-11-21T10:00:00Z","endsAt":"2026-11-21T09:00:00Z"}', '{}')`), /Invalid maintenance/);
    assert.match(errorOf(`select public.fitx_admin_op_save_platform_settings('${OWNER}', '{}', null, '{"instagramUrl":"https://evil.example/x"}')`), /Invalid Instagram/);

    const saved = pg.exec(`select public.fitx_admin_op_save_platform_settings('${OWNER}', '{"ai_coach":false,"support":true}',
      '{"title":"Planned upgrade","body":"FITX may be slow tonight.","startsAt":"2026-11-21T10:00:00Z","endsAt":null}',
      '{"supportEmail":"help@example.test","instagramUrl":"https://www.instagram.com/fitx/"}')`);
    const row = pg.json(`select to_json(s) from (select features, maintenance, site from public.platform_settings) s`, anon);
    assert.deepEqual(row.features, { ai_coach: false, support: true });
    assert.equal(row.maintenance.title, "Planned upgrade");
    assert.equal(row.maintenance.endsAt, null);
    assert.deepEqual(row.site, { supportEmail: "help@example.test", instagramUrl: "https://www.instagram.com/fitx/" });

    assert.match(errorOf(`select public.fitx_admin_op_save_platform_settings('${OWNER}', '{}', null, '{}', '2000-01-01T00:00:00Z')`), /platform_settings_changed/);
    pg.exec(`select public.fitx_admin_op_save_platform_settings('${OWNER}', '{}', null, '{}', '${saved}')`);

    const audit = pg.json(`select to_json(array(select details from public.fitx_admin_audit_logs where action = 'platform_settings_updated' order by id))`);
    assert.equal(audit.length, 2);
    assert.equal(audit[0].after.maintenance.on, true);
    assert.equal(JSON.stringify(audit).includes("FITX may be slow"), false, "the audit row never holds the maintenance text");
  });

  test("targeted notices reach only their recipients, who can dismiss but never undo it", () => {
    assert.match(errorOf(`select public.fitx_admin_op_send_notifications('${VIEWER}', array['${A}']::uuid[], 'Hello there', 'Body', 'info', null, null)`), /Notification permission required/);
    assert.match(errorOf(`select public.fitx_admin_op_send_notifications('${EDITOR}', array[]::uuid[], 'Hello there', 'Body', 'info', null, null)`), /at least one account/);
    assert.match(errorOf(`select public.fitx_admin_op_send_notifications('${EDITOR}', array['${A}', '99999999-0000-4000-8000-000000000009']::uuid[], 'Hello there', 'Body', 'info', null, null)`), /not found/);
    assert.match(errorOf(`select public.fitx_admin_op_send_notifications('${EDITOR}', array['${A}']::uuid[], 'Hi', 'Body', 'info', null, null)`), /check/);

    const sent = pg.json(`select public.fitx_admin_op_send_notifications('${EDITOR}', array['${A}', '${A}', '${C}']::uuid[], 'Your plan changed', 'We moved your rest day.', 'success', '/workouts', 'Open workouts')`);
    assert.equal(sent.sent, 2);

    assert.equal(pg.json(`select to_json(count(*)) from public.member_notifications`, asA), 1);
    assert.equal(pg.json(`select to_json(count(*)) from public.member_notifications`, asB), 0);
    assert.match(errorOf(`select created_by_operator_id from public.member_notifications`, asA), /permission denied/);
    assert.match(errorOf(`update public.member_notifications set title = 'Changed'`, asA), /permission denied/);

    pg.exec(`update public.member_notifications set dismissed_at = '2000-01-01T00:00:00Z'`, asB);
    assert.equal(pg.json(`select to_json(count(*)) from public.member_notifications where dismissed_at is not null`), 0, "another member's dismissal changes nothing");
    pg.exec(`update public.member_notifications set dismissed_at = '2000-01-01T00:00:00Z'`, asA);
    const dismissed = pg.json(`select to_json(dismissed_at) from public.member_notifications where user_id = '${A}'`);
    assert.ok(Date.parse(dismissed) > Date.parse("2026-01-01"), "the database stamps the dismissal itself");
    pg.exec(`update public.member_notifications set dismissed_at = null`, asA);
    assert.equal(pg.json(`select to_json(dismissed_at) from public.member_notifications where user_id = '${A}'`), dismissed);

    const history = pg.json(`select to_json(array(select h from public.fitx_admin_notification_history(10) h))`);
    assert.equal(history.length, 1);
    assert.equal(history[0].recipients, 2);
    assert.equal(history[0].dismissed, 1);
    assert.equal(history[0].operator_username, "editor");
    const audit = pg.json(`select to_json(details) from public.fitx_admin_audit_logs where action = 'notification_sent'`);
    assert.equal(audit.recipients, 2);
    assert.equal(JSON.stringify(audit).includes("rest day"), false);
  });

  test("support: complaints are a category, and a request is unread until an operator reads or answers it", () => {
    const id = pg.exec(`select public.fitx_submit_support_request('complaint', 'Charged twice', 'I was charged twice this month for one plan.', '/subscription')`, asA);
    const inbox = () => pg.json(`select public.fitx_admin_support_inbox()`);
    assert.equal(inbox().unread, 1);
    assert.equal(inbox().unread_by_category.complaint, 1);
    assert.equal(inbox().open_by_category.complaint, 1);
    assert.match(errorOf(`select staff_seen_at from public.support_requests`, asA), /permission denied/);

    assert.match(errorOf(`select public.fitx_admin_op_support_mark_seen('${EDITOR}', '${id}')`), /Support permission required/);
    assert.equal(pg.exec(`select public.fitx_admin_op_support_mark_seen('${OWNER}', '${id}')`), "t");
    assert.equal(pg.exec(`select public.fitx_admin_op_support_mark_seen('${OWNER}', '${id}')`), "f", "a second open changes nothing");
    assert.equal(inbox().unread, 0);
    assert.equal(pg.exec(`select staff_unread from public.support_requests where id = '${id}'`), "f");
    assert.equal(pg.json(`select to_json(count(*)) from public.fitx_admin_audit_logs where action = 'support_request_read'`), 1);

    pg.exec(`select public.fitx_reply_support_request('${id}', 'Any news?')`, asA);
    assert.equal(inbox().unread, 1, "a member's reply makes it unread again");
    pg.exec(`select public.fitx_admin_op_support_reply('${OWNER}', '${id}', 'Refund on its way.', 'waiting_on_user')`);
    assert.equal(inbox().unread, 0, "a staff reply counts as read");
  });

  test("account search v2: phone, name, sign-in methods, status and plan filters", () => {
    const search = (args) => pg.json(`select to_json(array(select r from public.fitx_admin_search_users_v2(${args}) r))`);
    const all = search("null, null, null, null, 25, 0");
    assert.deepEqual(all.map((row) => row.user_id), [C, B, A]);
    assert.deepEqual(all.find((row) => row.user_id === A).providers, ["email", "google"]);
    assert.equal(all.find((row) => row.user_id === A).display_name, "Asha Rao");
    assert.equal(Number(all[0].total_count), 3);
    assert.deepEqual(search("'98123', null, null, null, 25, 0").map((row) => row.user_id), [B]);
    assert.deepEqual(search("'asha', null, null, null, 25, 0").map((row) => row.user_id), [A]);
    assert.deepEqual(search("'%', null, null, null, 25, 0"), [], "% is matched literally");
    assert.deepEqual(search("null, 'suspended', null, null, 25, 0").map((row) => row.user_id), [B]);
    assert.deepEqual(search("null, 'active', null, null, 25, 0").map((row) => row.user_id), [C, A]);
    assert.deepEqual(search("null, 'unconfirmed', null, null, 25, 0").map((row) => row.user_id), [C]);
    assert.deepEqual(search("null, null, 'phone', null, 25, 0").map((row) => row.user_id), [C]);
    assert.deepEqual(search("null, null, null, 'premium', 25, 0"), []);
    assert.equal(search("null, null, null, 'free', 25, 0").length, 3);
    assert.match(errorOf(`select * from public.fitx_admin_search_users_v2()`, asA), /permission denied/);
  });

  test("overview extras and the security summary count without exposing keys", () => {
    const extras = pg.json(`select public.fitx_admin_overview_extras()`);
    assert.equal(extras.suspended, 1);
    assert.deepEqual(extras.methods, { email: 2, google: 1, phone: 1 });
    assert.deepEqual(extras.subscriptions, {});
    assert.equal(extras.premium, 0);

    for (let i = 0; i < 5; i += 1) {
      pg.exec(`select public.fitx_admin_login_check('editor', 'ip-one'); select public.fitx_admin_login_record('editor', 'ip-one', false);`);
    }
    pg.exec(`select public.fitx_admin_login_check('owner', 'ip-two'); select public.fitx_admin_login_record('owner', 'ip-two', true);`);
    const security = pg.json(`select public.fitx_admin_security_overview()`);
    assert.equal(security.failed_24h, 5);
    assert.equal(security.succeeded_24h, 1);
    assert.deepEqual(security.locked.map((row) => row.username), ["editor"]);
    assert.equal(security.daily.length, 14);
    assert.equal(security.daily.at(-1).failed, 5);
    assert.equal(JSON.stringify(security).includes("ip-one"), false);
    assert.match(errorOf(`select public.fitx_admin_security_overview()`, asA), /permission denied/);
  });

  test("the migration runs a second time without errors and keeps the data", () => {
    pg.applyFile(MIGRATION, { singleTransaction: true });
    assert.equal(pg.json(`select to_json(count(*)) from public.member_notifications`), 2);
    assert.equal(pg.json(`select to_json(count(*)) from public.platform_settings`), 1);
    assert.equal(pg.exec(`select count(*) from pg_constraint where conrelid = 'public.support_requests'::regclass and pg_get_constraintdef(oid) ilike '%complaint%'`), "1");
  });
});
