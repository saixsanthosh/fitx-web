// Explore reports' evidence (20261125100000) on a throwaway local Postgres: before that file a reporter could read
// the copy FITX stores with their report (here, a message its sender has since unsent); after it they still read what
// they reported, their reason and details, the status and the dates, and the columns "Download my data" names, but
// never the evidence or its purge time, in any form. Reporting, the clean-up and the server key's reads (Admin's own
// select lists) are unchanged, signed-out visitors read nothing, and the header's undo and a second run work. #51's
// file, run again by mistake, is put right by #52's file and then this one; run again as the last step of section 5's
// undo of #52 (which comes after this file's undo) it leaves the reports as after #51, with nothing more to run.
// Skipped when the Postgres binaries are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPORT_TABLES } from "@/lib/account/export";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";
const VERSION = "20261125100000";
const FILE = path.join(MIGRATIONS_DIR, `${VERSION}_fitx_social_reports_column_privileges.sql`);
const V1 = path.join(MIGRATIONS_DIR, "20261123100060_fitx_social_v1.sql");
/** #52, which added the evidence, and #53 and #54: section 5 of the runbook undoes this file, then #54, #53 and #52. */
const V2 = path.join(MIGRATIONS_DIR, "20261124100000_fitx_social_v2_core.sql");
const V2_GROUPS = path.join(MIGRATIONS_DIR, "20261124100010_fitx_social_v2_groups.sql");
const ADMIN_FILE = path.join(MIGRATIONS_DIR, "20261124100020_fitx_admin_explore.sql");
const ADMIN_EXPLORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "admin", "src", "lib", "data", "explore.ts");
const ASHA = "aaaaaaaa-5555-4000-8000-0000000000a1"; // the reporter
const BEN = "bbbbbbbb-5555-4000-8000-0000000000b2"; // the reported member
const CHEN = "cccccccc-5555-4000-8000-0000000000c3"; // not part of either report
const CONVERSATION = "0000eeee-5555-4000-8000-000000000001";
const MESSAGE = "0000eeee-5555-4000-8000-000000000002";
const MESSAGE_TEXT = "Send me your bank login and I will double your money";
const as = (sub) => ({ role: "authenticated", sub });
const SERVER = { role: "service_role" };
/** Every column of the table but the evidence and its purge time: what a member may read. */
const MEMBER_COLUMNS = ["id", "user_id", "target_type", "target_id", "target_user_id", "reason", "details", "status", "created_at", "reviewed_at"];
const REFUSED = /permission denied for table social_reports/;
// Who holds what on the table and on each of its columns, as the catalogue stores it.
const ACL = `select jsonb_build_object(
  'table', (select coalesce(jsonb_agg(a::text order by a::text), '[]') from pg_class c, unnest(c.relacl) a where c.oid = 'public.social_reports'::regclass),
  'columns', (select jsonb_object_agg(t.attname, t.acl) from (
    select a.attname, (select coalesce(jsonb_agg(x::text order by x::text), '[]') from unnest(a.attacl) x) as acl
    from pg_attribute a where a.attrelid = 'public.social_reports'::regclass and a.attnum > 0 and not a.attisdropped) t));`;
/** A migration header's undo: its "--   " lines after "-- Undo", up to the first statement, without the "-- then" notes. */
function headerUndo(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith("-- Undo"));
  const end = lines.findIndex((line, index) => index > start && !line.startsWith("--"));
  return lines.slice(start + 1, end).filter((line) => line.startsWith("--   ")).map((line) => line.slice(5))
    .filter((line) => !line.startsWith("-- then")).join("\n");
}

describe("Explore reports: the reporter reads their report, not its evidence", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  /** As production has it before this file: what the reporter could read, and the grants. */
  const beforeFile = { evidence: null, acl: null };
  /** The grants right after #51, before #52 added the evidence columns. */
  let afterV1 = null;
  let afterFile = null;
  let applied = [];
  const reads = (who, sql) => pg.run(sql, as(who));
  const refused = (who, sql) => {
    const result = reads(who, sql);
    assert.ok(!result.ok && REFUSED.test(result.stderr), `${sql}: ${result.stderr || "it was not refused"}`);
  };
  const reportIds = () => pg.json(`select jsonb_agg(id order by target_type) from public.social_reports where user_id = '${ASHA}';`);

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ before: "20261124100000" });
    afterV1 = pg.json(ACL);
    pg.applyMigrations({ from: "20261124100000", before: VERSION });
    pg.exec(`insert into auth.users (id, email) values ('${ASHA}', 'asha@example.test'), ('${BEN}', 'ben@example.test'), ('${CHEN}', 'chen@example.test');
      update public.profiles set date_of_birth = date '1990-01-01' where id in ('${ASHA}', '${BEN}', '${CHEN}');`);
    for (const [who, name, bio] of [[ASHA, "asha.five", ""], [BEN, "ben.five", "Message me for cheap followers"], [CHEN, "chen.five", ""]]) {
      pg.exec(`select public.fitx_social_save_profile('${name}', 'X', '${bio}', false, 'everyone');`, as(who));
    }
    // Ben sends Asha a message; she reports it and his account, and then he unsends it (its text is blanked).
    pg.exec(`insert into public.social_conversations (id, user_low, user_high, status, requested_by) values ('${CONVERSATION}', '${ASHA}', '${BEN}', 'accepted', '${BEN}');
      insert into public.social_messages (id, conversation_id, user_id, body) values ('${MESSAGE}', '${CONVERSATION}', '${BEN}', '${MESSAGE_TEXT}');`);
    pg.exec(`select public.fitx_social_report('message', '${MESSAGE}', 'scam', 'He asked for my bank login');`, as(ASHA));
    pg.exec(`select public.fitx_social_report('account', '${BEN}', 'spam', null);`, as(ASHA));
    pg.exec(`select public.fitx_social_unsend_message('${MESSAGE}');`, as(BEN));
    beforeFile.evidence = pg.json(`select coalesce(jsonb_agg(evidence order by target_type), '[]') from public.social_reports;`, as(ASHA));
    beforeFile.acl = pg.json(ACL);
    applied = pg.applyMigrations({ from: VERSION });
    afterFile = pg.json(ACL);
  });
  after(() => pg?.stop());

  test("before this file the reporter could read the evidence, the unsent message included", () => {
    assert.equal(pg.json(`select to_jsonb(body) from public.social_messages where id = '${MESSAGE}';`, SERVER), "", "Ben unsent it");
    assert.equal(beforeFile.evidence.length, 2);
    assert.equal(beforeFile.evidence[1].body, MESSAGE_TEXT, "the copy of his message reached Asha through the API");
    assert.equal(beforeFile.evidence[0].bio, "Message me for cheap followers");
    assert.equal(applied[0], path.basename(FILE), "then the file applies");
  });

  test("the reporter can no longer read the evidence or its purge time, in any form", () => {
    for (const sql of [
      "select evidence from public.social_reports;",
      "select evidence->>'body' from public.social_reports;",
      "select evidence_purge_at from public.social_reports;",
      "select * from public.social_reports;",
      "select to_jsonb(r) from public.social_reports r;",
      "select id from public.social_reports where evidence is not null;",
      "select id from public.social_reports order by evidence_purge_at;",
    ]) refused(ASHA, sql);
  });

  test("the reporter still reads what they reported, their reason and details, the status and the dates", () => {
    const rows = pg.json(`select coalesce(jsonb_agg(to_jsonb(r) order by r.target_type), '[]') from (select ${MEMBER_COLUMNS.join(", ")} from public.social_reports) r;`, as(ASHA));
    assert.deepEqual(rows.map((row) => Object.keys(row).sort()), [[...MEMBER_COLUMNS].sort(), [...MEMBER_COLUMNS].sort()]);
    assert.deepEqual(rows.map(({ target_type, target_id, target_user_id, reason, details, status }) => ({ target_type, target_id, target_user_id, reason, details, status })), [
      { target_type: "account", target_id: BEN, target_user_id: BEN, reason: "spam", details: null, status: "open" },
      { target_type: "message", target_id: MESSAGE, target_user_id: BEN, reason: "scam", details: "He asked for my bank login", status: "open" },
    ]);
    assert.ok(rows.every((row) => row.user_id === ASHA && row.created_at && row.reviewed_at === null));
    assert.equal(pg.json("select count(*) from public.social_reports;", as(ASHA)), 2, "a count (count=exact) still works");
    // Row level security is unchanged: nobody else reads Asha's reports, the reported member included.
    assert.equal(pg.json("select count(*) from public.social_reports;", as(BEN)), 0);
    assert.equal(pg.json("select count(*) from public.social_reports;", as(CHEN)), 0);
    assert.equal(pg.json(`select count(*) from public.social_reports where user_id = '${ASHA}';`, as(CHEN)), 0);
  });

  test("Download my data's select list for reports still reads, as the member, as the export pages it", () => {
    const spec = EXPORT_TABLES.find((entry) => entry.table === "social_reports");
    assert.ok(spec?.columns, "the export names its columns");
    assert.deepEqual(spec.columns.split(",").sort(), [...MEMBER_COLUMNS].sort(), "the export reads exactly the columns members hold");
    const order = typeof spec.order === "string" ? [spec.order] : [...spec.order];
    const page = (who) => pg.json(`select coalesce(jsonb_agg(to_jsonb(p)), '[]') from (select ${spec.columns} from public.social_reports
      where ${spec.owner} = '${who}' order by ${order.join(", ")} limit 1000 offset 0) p;`, as(who));
    const rows = page(ASHA);
    assert.equal(rows.length, 2);
    assert.deepEqual([...rows.map((row) => row.id)].sort(), [...reportIds()].sort());
    assert.ok(rows.every((row) => !("evidence" in row) && !("evidence_purge_at" in row)));
    assert.deepEqual(page(CHEN), []);
  });

  test("only the members' read changes: ten columns readable, nothing table-wide, every other right as before", () => {
    const member = (entry) => entry.startsWith("authenticated=");
    assert.ok(beforeFile.acl.table.some(member), "before: a table-wide read");
    assert.deepEqual(afterFile.table, beforeFile.acl.table.filter((entry) => !member(entry)), "the server key and the owner keep every right");
    assert.ok(!afterFile.table.some((entry) => /^(=|anon=)/.test(entry)), "signed-out visitors and PUBLIC hold nothing");
    const readable = Object.entries(afterFile.columns).filter(([, acl]) => acl.some(member)).map(([name]) => name).sort();
    assert.deepEqual(readable, [...MEMBER_COLUMNS].sort());
    for (const [name, acl] of Object.entries(afterFile.columns)) {
      assert.deepEqual(acl.filter((entry) => !member(entry)), beforeFile.acl.columns[name], `${name}: no other column right moves`);
      if (acl.some(member)) assert.deepEqual(acl.filter(member).map((entry) => entry.split("/")[0]), ["authenticated=r"], `${name}: a read, nothing more`);
    }
  });

  test("signed-out visitors read nothing of it", () => {
    for (const sql of ["select count(*) from public.social_reports;", "select id from public.social_reports;"]) {
      const result = pg.run(sql, { role: "anon" });
      assert.ok(!result.ok && REFUSED.test(result.stderr), `${sql}: ${result.stderr || "it was not refused"}`);
    }
  });

  test("the server key still reads everything: each of Admin's select lists on reports, the evidence included", () => {
    const source = readFileSync(ADMIN_EXPLORE, "utf8");
    const lists = [...new Set([...source.matchAll(/\.from\("social_reports"\)\s*\.select\("([^"]+)"/g)].map((match) => match[1]))];
    assert.ok(lists.some((list) => list.split(",").includes("evidence")), "Admin's report page reads the evidence");
    for (const list of lists) {
      const result = pg.run(`select ${list} from public.social_reports;`, SERVER);
      assert.ok(result.ok, `${list}: ${result.stderr}`);
    }
    const evidence = pg.json(`select jsonb_agg(evidence order by target_type) from public.social_reports where user_id = '${ASHA}';`, SERVER);
    assert.equal(evidence[1].body, MESSAGE_TEXT, "FITX's moderators still see the unsent message");
    assert.equal(evidence[0].username, "ben.five");
    assert.equal(pg.json("select count(*) from (select * from public.social_reports) r;", SERVER), 2);
  });

  test("reporting and the 90-day clean-up work as before", () => {
    const [account] = reportIds();
    assert.equal(pg.json(`select to_jsonb(public.fitx_social_report('account', '${BEN}', 'harassment', 'Still spamming'));`, as(ASHA)), account,
      "a second report of the same thing updates the first, as the member");
    assert.equal(pg.json(`select to_jsonb(reason) from public.social_reports where id = '${account}';`, as(ASHA)), "harassment");
    assert.equal(pg.json(`select evidence->'bio' from public.social_reports where id = '${account}';`, SERVER), "Message me for cheap followers");
    pg.exec(`update public.social_reports set status = 'dismissed', reviewed_at = now() - interval '91 days' where id = '${account}';`);
    const swept = pg.json("select public.fitx_social_hourly();", SERVER);
    assert.equal(swept.evidence_purged, 1, JSON.stringify(swept));
    assert.equal(pg.json(`select to_jsonb(evidence is null) from public.social_reports where id = '${account}';`, SERVER), true);
    assert.deepEqual(pg.json(`select jsonb_build_object('status', status, 'reviewed', reviewed_at is not null) from public.social_reports where id = '${account}';`, as(ASHA)),
      { status: "dismissed", reviewed: true }, "the reporter sees it was reviewed");
  });

  test("the header's undo gives back exactly the grants before the file, and the file then applies again, twice", () => {
    const undo = headerUndo(FILE);
    assert.match(undo, /^begin;\n[^]*\ncommit;$/);
    const ran = pg.run(undo);
    assert.ok(ran.ok, ran.stderr);
    assert.deepEqual(pg.json(ACL), beforeFile.acl);
    assert.ok(reads(ASHA, "select evidence from public.social_reports;").ok, "members read every column again");
    pg.applyFile(FILE, { singleTransaction: true });
    pg.applyFile(FILE, { singleTransaction: true });
    assert.deepEqual(pg.json(ACL), afterFile, "a second run ends as the first did");
    refused(ASHA, "select evidence from public.social_reports;");
  });

  test("#51's file, run again by mistake while #52 and this file are in place, gives members every column back; #52's file and then this one, run again after it, put that right", () => {
    pg.applyFile(V1, { singleTransaction: true });
    assert.deepEqual(pg.json(ACL), beforeFile.acl, "#51's grant names the whole table");
    assert.ok(reads(ASHA, "select evidence from public.social_reports;").ok);
    pg.applyFile(V2, { singleTransaction: true });
    assert.deepEqual(pg.json(ACL), beforeFile.acl, "#52's file leaves the reports' grants as it finds them, so this file runs after it");
    pg.applyFile(FILE, { singleTransaction: true });
    assert.deepEqual(pg.json(ACL), afterFile);
    refused(ASHA, "select evidence from public.social_reports;");
  });

  // Last: it takes Explore part 2 away.
  test("section 5 undoes this file before #52, so #51's file, run again as the last step of #52's undo, leaves the reports as after #51 and this file does not run again", () => {
    for (const file of [FILE, ADMIN_FILE, V2_GROUPS, V2]) {
      const ran = pg.run(headerUndo(file));
      assert.ok(ran.ok, `${path.basename(file)}'s undo: ${ran.stderr}`);
    }
    pg.applyFile(V1, { singleTransaction: true });
    assert.deepEqual(pg.json(ACL), afterV1, "members' read of their reports is exactly as after #51, and no evidence column is left to hide");
    assert.ok(reads(ASHA, "select * from public.social_reports;").ok, "the reporter reads every column of their reports, as after #51");
  });
});
