// Admin's Dashboard banner (src/lib/data/metrics.ts getSupportCounts, src/app/(control)/overview/page.tsx) with a fake
// Supabase: help requests per status are read as Support's inbox reads them (statusCounts in data/support.ts). A count
// that cannot be read is null and the banner says "Not known", never 0; a status the database leaves out has no
// requests, a real 0. A failed query leaves every count unknown; before the function exists there is nothing to show.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv } from "./helpers/fakes.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const metrics = await importTypeScriptModule("src/lib/data/metrics.ts", SESSION_STUBS);
const viewer = { id: "00000000-0000-4000-8000-0000000000c5", username: "agent", role: "support_agent", sessionId: "s-own", isRoot: false, permissions: ["support.view"] };
const MISSING = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
const STATUSES = ["open", "in_progress", "waiting_on_user", "resolved", "closed"];

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = viewer;
});

/** fitx_admin_support_counts answers `answer`. */
function counts(answer) {
  fake.handler = (call) => (call.rpc === "fitx_admin_support_counts" ? answer : { data: null, error: null });
}

async function readLogged() {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    return { result: await metrics.getSupportCounts(), errors };
  } finally {
    console.error = original;
  }
}

test("a status count that is not a count is null, never 0, and is logged; a status left out is a real 0", async () => {
  counts({ data: { open: 4, in_progress: "abc", waiting_on_user: "2", resolved: -1 }, error: null });
  const { result, errors } = await readLogged();
  assert.equal(rpcCalls("fitx_admin_support_counts").length, 1);
  assert.deepEqual(result, { open: 4, in_progress: null, waiting_on_user: 2, resolved: null, closed: 0 });
  assert.equal(errors.filter((line) => line.includes("data.support_status_counts")).length, 2, errors.join("\n"));
});

test("counts that are not an object at all, or a failed query: every status is unknown, and that is logged", async () => {
  for (const data of [null, [3, 1], "4"]) {
    counts({ data, error: null });
    const { result, errors } = await readLogged();
    assert.deepEqual(Object.keys(result), STATUSES, JSON.stringify(data));
    assert.ok(Object.values(result).every((count) => count === null), JSON.stringify(data));
    assert.ok(errors.some((line) => line.includes("data.support_status_counts")), errors.join("\n"));
  }
  counts({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
  const { result, errors } = await readLogged();
  assert.deepEqual(result, Object.fromEntries(STATUSES.map((status) => [status, null])), "a failed query is unknown: not 0, and not nothing to show");
  assert.ok(errors.some((line) => line.includes("data.support_counts")), errors.join("\n"));
});

test("before the function exists there is nothing to show, and nothing is logged", async () => {
  counts(MISSING);
  const { result, errors } = await readLogged();
  assert.equal(result, null);
  assert.deepEqual(errors, []);
});

test("every count read: the numbers, Postgres digits and a real 0 for a status with no requests", async () => {
  counts({ data: { open: 3, in_progress: "12", waiting_on_user: 0 }, error: null });
  const { result, errors } = await readLogged();
  assert.deepEqual(result, { open: 3, in_progress: 12, waiting_on_user: 0, resolved: 0, closed: 0 });
  assert.deepEqual(errors, []);
});

test("the Dashboard's banner says 'Not known' for a count that could not be read, and never sums an unknown as 0", async () => {
  const page = await readFile(new URL("../src/app/(control)/overview/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const countText = \(count: number \| null\) => \(count === null \? "Not known" : count\.toLocaleString\("en-IN"\)\);/);
  assert.match(page, /for \(const status of \["open", "in_progress", "waiting_on_user"\] as const\) \{\s*const count = counts\[status\];\s*if \(count === null\) return null;\s*sum \+= count;/,
    "one unknown count of the three makes the total unknown");
  assert.match(page, /const waiting = supportCounts \? waitingCount\(supportCounts\) : null;/);
  assert.match(page, /\{supportCounts && \(waiting === null \|\| waiting > 0\) && \(/, "the banner stays while the total is unknown");
  assert.match(page, /\? <span>Help requests waiting: <strong>Not known<\/strong> · New: \{countText\(supportCounts\.open\)\}<\/span>/);
  assert.match(page, /: <span><strong>\{waiting\.toLocaleString\("en-IN"\)\}<\/strong> help requests waiting · \{countText\(supportCounts\.open\)\} new<\/span>/);
  assert.doesNotMatch(page, /supportCounts\??\.[a-z_]+ \?\? 0|waiting \?\? 0/, "no unknown count is shown or summed as 0");
});
