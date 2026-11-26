// Admin's Dashboard banner (src/lib/data/support.ts getSupportSummary, src/lib/support-banner.ts,
// src/app/(control)/overview/page.tsx) with a fake Supabase. It reads the Support inbox's own counts
// (fitx_admin_support_inbox, else the older fitx_admin_support_counts) and says what the inbox says: how many requests
// need attention and how many are unread (BUGS.md 64: it used to call the Open ones "new"). A count that cannot be
// read is null and the banner says "Not known", never 0; a status the database leaves out has no requests, a real 0.
// A failed query leaves every count unknown; before any function exists there is nothing to show.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv } from "./helpers/fakes.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const support = await importTypeScriptModule("src/lib/data/support.ts", SESSION_STUBS);
const { needingAttention, supportBanner } = await importTypeScriptModule("src/lib/support-banner.ts");
const viewer = { id: "00000000-0000-4000-8000-0000000000c5", username: "agent", role: "support_agent", sessionId: "s-own", isRoot: false, permissions: ["support.view"] };
const MISSING = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
const STATUSES = ["open", "in_progress", "waiting_on_user", "resolved", "closed"];
const unknownAll = () => Object.fromEntries(STATUSES.map((status) => [status, null]));

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = viewer;
});

/** fitx_admin_support_inbox answers `inbox` (or is missing), and the older fitx_admin_support_counts answers `older`. */
function answer({ inbox = MISSING, older = MISSING }) {
  fake.handler = (call) => (call.rpc === "fitx_admin_support_inbox" ? inbox : call.rpc === "fitx_admin_support_counts" ? older : { data: null, error: null });
}

/** The summary without its stamp, which is checked here: the time its counts were asked for (menu-badge-counts.test.mjs). */
async function readLogged() {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const before = Date.now();
    const summary = await support.getSupportSummary();
    if (summary === null) return { result: null, errors };
    const { countedAt, ...result } = summary;
    assert.ok(countedAt >= before && countedAt <= Date.now(), "the counts carry the time they were asked for");
    return { result, errors };
  } finally {
    console.error = original;
  }
}

test("the banner reads the inbox's own counts: per status and unread, as the inbox shows them", async () => {
  answer({ inbox: { data: { by_status: { open: 4, in_progress: "2", waiting_on_user: 1, closed: 9 }, unread: 3, open_by_category: {}, unread_by_category: {} }, error: null } });
  const { result, errors } = await readLogged();
  assert.deepEqual(result, { byStatus: { open: 4, in_progress: 2, waiting_on_user: 1, resolved: 0, closed: 9 }, unread: 3 });
  assert.deepEqual(errors, []);
  assert.equal(rpcCalls("fitx_admin_support_inbox").length, 1);
});

test("an unread count that is not a count is unknown and logged, never 0; a bad status count is unknown too", async () => {
  answer({ inbox: { data: { by_status: { open: 4, in_progress: "abc" }, unread: "lots" }, error: null } });
  const { result, errors } = await readLogged();
  assert.equal(result.unread, null);
  assert.equal(result.byStatus.in_progress, null);
  assert.ok(errors.some((line) => line.includes("data.support_unread")), errors.join("\n"));
  assert.ok(errors.some((line) => line.includes("data.support_status_counts")), errors.join("\n"));
});

test("before the inbox function, the older counts are read and unread is not known; a failed read leaves everything unknown", async () => {
  answer({ older: { data: { open: 3, closed: -1 }, error: null } });
  const older = await readLogged();
  assert.deepEqual(older.result, { byStatus: { open: 3, in_progress: 0, waiting_on_user: 0, resolved: 0, closed: null }, unread: null });
  answer({ inbox: { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } });
  const failed = await readLogged();
  assert.deepEqual(failed.result, { byStatus: unknownAll(), unread: null }, "a failed query is unknown: not 0, and not nothing to show");
  assert.ok(failed.errors.some((line) => line.includes("data.support_inbox")), failed.errors.join("\n"));
});

test("before any support function exists there is nothing to show, and nothing is logged", async () => {
  answer({});
  const { result, errors } = await readLogged();
  assert.equal(result, null);
  assert.deepEqual(errors, []);
});

const summary = (byStatus, unread) => ({ byStatus: { open: 0, in_progress: 0, waiting_on_user: 0, resolved: 0, closed: 0, ...byStatus }, unread });

test("the banner says what the inbox says: need attention and unread, never Open as 'new'", () => {
  // The hunt: 4 Open, of which none unread after one was read; the inbox said "0 unread · 4 need attention".
  assert.deepEqual(supportBanner(summary({ open: 4 }, 0)), { href: "/support", text: "4 help requests need attention · 0 unread" });
  // The verification run: 7 waiting, 3 unread.
  assert.deepEqual(supportBanner(summary({ open: 4, in_progress: 2, waiting_on_user: 1 }, 3)), { href: "/support", text: "7 help requests need attention · 3 unread" });
  assert.deepEqual(supportBanner(summary({ waiting_on_user: 1 }, 1)), { href: "/support", text: "1 help request needs attention · 1 unread" });
  assert.deepEqual(supportBanner(summary({ open: 2 }, null)), { href: "/support", text: "2 help requests need attention" }, "unread is left out before the inbox can count it");
  assert.deepEqual(supportBanner(summary({ closed: 5 }, 2)), { href: "/support?status=all&unread=1", text: "2 unread help requests" }, "only unread: it opens the Unread tab");
  assert.equal(supportBanner(summary({ closed: 5 }, 0)), null, "nothing needs attention and nothing is unread");
  assert.equal(supportBanner(summary({ closed: 5 }, null)), null);
  assert.equal(supportBanner(null), null);
});

test("an unknown count keeps the banner up and says 'Not known', never adding an unknown as 0", () => {
  assert.equal(needingAttention({ open: 3, in_progress: null, waiting_on_user: 1, resolved: 0, closed: 0 }), null);
  assert.equal(needingAttention({ open: 3, in_progress: 0, waiting_on_user: 1, resolved: null, closed: null }), 4, "only the three statuses that need attention count");
  assert.deepEqual(supportBanner(summary({ open: 3, in_progress: null }, 2)), { href: "/support", text: "Help requests needing attention: Not known · 2 unread" });
  assert.deepEqual(supportBanner({ byStatus: unknownAll(), unread: null }), { href: "/support", text: "Help requests needing attention: Not known" });
});

test("the Dashboard draws the banner from the inbox's summary only", async () => {
  const page = await readFile(new URL("../src/app/(control)/overview/page.tsx", import.meta.url), "utf8");
  assert.match(page, /canSupport \? getSupportSummary\(\) : Promise\.resolve\(null\)/);
  assert.match(page, /const banner = supportBanner\(support\);/);
  assert.match(page, /<Link className="attention-banner" href=\{banner\.href\}>/);
  assert.doesNotMatch(page, /\bnew<\/span>|New: /, "no count of Open requests is called new");
  assert.doesNotMatch(page, /\?\? 0/, "no unknown count is shown or summed as 0");
});
