// The Announcements list and page name who made each announcement (BUGS.md 68, admin-3): an announcement made in
// Admin records the operator (created_by_operator_id), and the list read only the old Google-era created_by, so it
// said "Created by —" for every one of them.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fake, resetFakes, SESSION_STUBS, setTestEnv, tableCalls } from "./helpers/fakes.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const announcements = await importTypeScriptModule("src/lib/data/announcements.ts", SESSION_STUBS);
const OPERATOR = "00000000-0000-4000-8000-0000000000a1";
const MEMBER = "00000000-0000-4000-8000-0000000000c1";
const row = (id, extra) => ({ id, title: "Upgrade tonight", body: "Short break.", tone: "info", link_url: null, link_label: null, status: "draft", starts_at: null, ends_at: null, published_at: null, created_by: null, created_by_operator_id: null, updated_at: "2026-11-25T10:00:00Z", ...extra });

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = { id: OPERATOR, username: "huntadmin", role: "super_admin", permissions: ["announcements.manage"] };
});

function database(rows) {
  fake.handler = (call) => {
    if (call.table === "announcements") return call.final === "maybeSingle" ? { data: rows[0], error: null } : { data: rows, error: null };
    if (call.table === "admin_operators") return { data: [{ id: OPERATOR, username: "huntadmin" }], error: null };
    if (call.rpc === "fitx_admin_user_emails") return { data: [{ user_id: MEMBER, email: "old.admin@example.test" }], error: null };
    if (call.rpc === "fitx_admin_announcement_dismissals") return { data: [], error: null };
    return { data: null, error: null };
  };
}

test("the list names the operator who made an announcement in Admin, and an old member's email for older ones", async () => {
  database([
    row("00000000-0000-4000-8000-000000000001", { created_by_operator_id: OPERATOR }),
    row("00000000-0000-4000-8000-000000000002", { created_by: MEMBER }),
    row("00000000-0000-4000-8000-000000000003", {}),
  ]);
  const result = await announcements.listAnnouncements();
  assert.equal(result.state, "ready");
  assert.deepEqual(result.rows.map((entry) => entry.createdBy), ["huntadmin", "old.admin@example.test", null]);
  const select = tableCalls("announcements")[0].ops.find(([op]) => op === "select")[1];
  assert.match(select, /created_by_operator_id/, "the operator column is read");
});

test("an announcement's own page has its creator too", async () => {
  database([row("00000000-0000-4000-8000-000000000001", { created_by_operator_id: OPERATOR })]);
  const result = await announcements.getAnnouncement("00000000-0000-4000-8000-000000000001");
  assert.equal(result.row.createdBy, "huntadmin");
  const page = await readFile(new URL("../src/app/(control)/announcements/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\{row\.createdBy \? ` Created by \$\{row\.createdBy\}\.` : ""\}/);
});

test("the creator's name: the operator first, then an old member's email, else not known", () => {
  const operators = new Map([[OPERATOR, "huntadmin"]]);
  const emails = new Map([[MEMBER, "old.admin@example.test"]]);
  assert.equal(announcements.creatorLabel({ created_by_operator_id: OPERATOR, created_by: MEMBER }, operators, emails), "huntadmin");
  assert.equal(announcements.creatorLabel({ created_by_operator_id: "00000000-0000-4000-8000-0000000000ff", created_by: MEMBER }, operators, emails), "old.admin@example.test");
  assert.equal(announcements.creatorLabel({ created_by_operator_id: null, created_by: null }, operators, emails), null);
});
