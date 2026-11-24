// Admin's support inbox (src/lib/data/support.ts listSupportRequests) with a fake Supabase: a status count that cannot be
// read is null (the inbox says "Not known"), never 0, and the failure is logged. The database groups requests by status,
// so a status it leaves out has no requests: that one is a real 0. As explore.ts does for its report counts.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv } from "./helpers/fakes.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const support = await importTypeScriptModule("src/lib/data/support.ts", SESSION_STUBS);
const viewer = { id: "00000000-0000-4000-8000-0000000000c4", username: "agent", role: "support_agent", sessionId: "s-own", isRoot: false, permissions: ["support.view"] };
const FILTERS = { status: "active", category: null, mine: false, unread: false, page: 1 };
const MISSING = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = viewer;
});

/** The inbox function answers `inbox` (or is missing, so the older counts function answers `older`); the list is empty. */
function answer({ inbox, older }) {
  fake.handler = (call) => {
    if (call.rpc === "fitx_admin_support_inbox") return inbox === undefined ? MISSING : { data: inbox, error: null };
    if (call.rpc === "fitx_admin_support_counts") return { data: older, error: null };
    if (call.table === "support_requests") return { data: [], count: 0, error: null };
    return { data: [], error: null };
  };
}

async function listLogged() {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    return { result: await support.listSupportRequests(FILTERS), errors };
  } finally {
    console.error = original;
  }
}

const inbox = (byStatus) => ({ by_status: byStatus, open_by_category: {}, unread: 1, unread_by_category: {} });

test("a status count that is not a count is null, never 0, and is logged; the others are kept", async () => {
  answer({ inbox: inbox({ open: 4, in_progress: "abc", waiting_on_user: 2, resolved: null }) });
  const { result, errors } = await listLogged();
  assert.equal(result.state, "ready");
  assert.equal(result.counts.in_progress, null, "unknown is never shown as 0");
  assert.equal(result.counts.resolved, null, "a null count is not a count either");
  assert.equal(result.counts.open, 4);
  assert.equal(result.counts.waiting_on_user, 2);
  assert.equal(result.counts.closed, 0, "a status the database left out has no requests");
  assert.equal(errors.filter((line) => line.includes("data.support_status_counts")).length, 2, errors.join("\n"));
});

test("counts that are not an object at all: every status is unknown, and that is logged", async () => {
  for (const byStatus of [undefined, null, [3, 1], "4"]) {
    answer({ inbox: inbox(byStatus) });
    const { result, errors } = await listLogged();
    assert.equal(result.state, "ready");
    assert.ok(Object.values(result.counts).every((count) => count === null), JSON.stringify(byStatus));
    assert.equal(Object.keys(result.counts).length, 5, "one entry for every status");
    assert.ok(errors.some((line) => line.includes("data.support_status_counts")), errors.join("\n"));
  }
});

test("every count read: the numbers, a real 0 for a status with no requests, and Postgres digits", async () => {
  answer({ inbox: inbox({ open: 4, in_progress: "12", waiting_on_user: 0 }) });
  const { result, errors } = await listLogged();
  assert.deepEqual(result.counts, { open: 4, in_progress: 12, waiting_on_user: 0, resolved: 0, closed: 0 });
  assert.equal(result.inbox.byStatus, result.counts);
  assert.deepEqual(errors, []);
});

test("before the inbox function exists, the older counts are read the same way", async () => {
  answer({ older: { open: 3, closed: -1 } });
  const { result, errors } = await listLogged();
  assert.equal(rpcCalls("fitx_admin_support_counts").length, 1);
  assert.equal(result.inbox.unread, null);
  assert.deepEqual(result.counts, { open: 3, in_progress: 0, waiting_on_user: 0, resolved: 0, closed: null });
  assert.ok(errors.some((line) => line.includes("data.support_status_counts")), errors.join("\n"));
});

test("the inbox says 'Not known' for a count that could not be read, and never adds an unknown into Needs attention", async () => {
  const page = await readFile(new URL("../src/app/(control)/support/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const countText = \(count: number \| null\) => \(count === null \? "Not known" : count\.toLocaleString\("en-IN"\)\);/);
  assert.match(page, /Needs attention <b>\{countText\(waiting\)\}<\/b>/);
  assert.match(page, /<b>\{countText\(result\.counts\[status\]\)\}<\/b>/);
  assert.match(page, /if \(count === null\) return null;\s*sum \+= count;/, "one unknown count makes the total unknown");
  assert.match(page, /waiting === null \? null : `\$\{waiting\.toLocaleString\("en-IN"\)\} need attention`/, "the page head leaves an unknown total out");
  assert.doesNotMatch(page, /result\.counts\[status\] \?\? 0|waiting \?\? 0/, "no unknown count is shown or summed as 0");
});
