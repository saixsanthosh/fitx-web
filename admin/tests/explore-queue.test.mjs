// Admin's Explore queue (src/lib/data/explore.ts listReports) with a fake Supabase: a report-status count that cannot
// be read is null (shown as "Not known"), never 0, and the failure is logged; the counts that could be read stay.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fake, resetFakes, SESSION_STUBS, setTestEnv, tableCalls } from "./helpers/fakes.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const explore = await importTypeScriptModule("src/lib/data/explore.ts", SESSION_STUBS);
const viewer = { id: "00000000-0000-4000-8000-0000000000c3", username: "agent", role: "support_agent", sessionId: "s-own", isRoot: false, permissions: ["explore.view"] };

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = viewer;
});

const statusOf = (call) => call.ops.find(([op, column]) => op === "eq" && column === "status")?.[2];
const isHeadCount = (call) => call.ops.some(([op, , options]) => op === "select" && options?.head === true);

function answer(failing) {
  fake.handler = (call) => {
    if (call.rpc === "fitx_admin_role_permissions") return { data: ["explore.view"], error: null };
    if (call.table === "social_reports" && isHeadCount(call)) {
      const status = statusOf(call);
      if (failing.has(status)) return { data: null, count: null, error: { message: "canceling statement due to statement timeout", code: "57014" } };
      return { data: null, count: { open: 4, reviewing: 2, actioned: 7, dismissed: 0 }[status], error: null };
    }
    if (call.table === "social_reports") return { data: [], count: 0, error: null };
    return { data: [], error: null };
  };
}

test("a status count that fails is null, never 0, and is logged; the others are kept", async () => {
  answer(new Set(["open"]));
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  let result;
  try {
    result = await explore.listReports({ page: 1, status: "waiting", target: null });
  } finally {
    console.error = original;
  }
  assert.equal(result.state, "ready");
  assert.equal(result.counts.open, null, "unknown is never shown as 0");
  assert.equal(result.counts.reviewing, 2);
  assert.equal(result.counts.actioned, 7);
  assert.ok(errors.some((line) => line.includes("data.explore_report_counts")), errors.join("\n"));
  assert.ok(tableCalls("social_reports").filter(isHeadCount).length >= 4, "one head count per status");
});

test("every count read: the numbers, including a real 0", async () => {
  answer(new Set());
  const result = await explore.listReports({ page: 1, status: "waiting", target: null });
  assert.equal(result.state, "ready");
  assert.equal(result.counts.open, 4);
  assert.equal(result.counts.dismissed, 0, "a count that was read as 0 stays 0");
  assert.ok(Object.values(result.counts).every((count) => typeof count === "number"));
});

test("the queue's status tabs say 'Not known' for a count that could not be read", async () => {
  const page = await readFile(new URL("../src/app/(control)/explore/page.tsx", import.meta.url), "utf8");
  assert.match(page, /count === null \? "Not known"/);
  assert.match(page, /Waiting <b>\{countText\(waiting\)\}<\/b>/);
  assert.match(page, /<b>\{countText\(result\.counts\[status\]\)\}<\/b>/);
  assert.doesNotMatch(page, /result\.counts\.open \+ result\.counts\.reviewing : null/, "an unknown count is not added up as a number");
});
