import test from "node:test";
import assert from "node:assert/strict";
import {
  FIRST_PLAN_PAGE,
  PLAN_SEGMENTS,
  composePlanPage,
  mergePlansById,
  planCardStatus,
  planPageRequests,
  planSegmentSpec,
} from "../../src/app/(dashboard)/workouts/_lib/plan-list.ts";

const today = "2026-11-16";

/** Applies a segment spec the way PostgREST would: filter on planned_for, sort, inclusive range. */
function runSegment(plans, request, todayKey) {
  const spec = planSegmentSpec(request.segment, todayKey);
  const matches = (plan) => spec.filter.op === "is" ? plan.planned_for === null
    : plan.planned_for !== null && (spec.filter.op === "gte" ? plan.planned_for >= spec.filter.value : plan.planned_for < spec.filter.value);
  const sorted = plans.filter(matches).sort((a, b) => {
    for (const { column, ascending } of spec.order) {
      if (a[column] === b[column]) continue;
      return (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1);
    }
    return 0;
  });
  return sorted.slice(request.from, request.to + 1);
}

/** What the page does: one request per remaining segment, then compose. */
function fetchPage(plans, cursor, pageSize, todayKey = today) {
  const requests = planPageRequests(cursor, pageSize);
  return composePlanPage(requests.map((request) => ({ segment: request.segment, from: request.from, rows: runSegment(plans, request, todayKey) })), pageSize);
}

function fetchAll(plans, pageSize) {
  const pages = [];
  let cursor = FIRST_PLAN_PAGE;
  while (cursor) {
    const page = fetchPage(plans, cursor, pageSize);
    pages.push(page.rows);
    cursor = page.next;
    assert.ok(pages.length <= plans.length + 2, "paging ends");
  }
  return pages;
}

function plan(id, plannedFor, createdAt) {
  return { id, title: id, planned_for: plannedFor, status: plannedFor ? "scheduled" : "draft", split: "full_body", created_at: createdAt };
}

// The review's case: 30 finished plans with past dates, then a new plan for today.
const pastPlans = Array.from({ length: 30 }, (_, index) => plan(`past-${String(index + 1).padStart(2, "0")}`, `2026-10-${String(index + 1).padStart(2, "0")}`, `2026-09-01T10:${String(index).padStart(2, "0")}:00.000Z`));
const todayPlan = plan("new-today", today, "2026-11-16T07:00:00.000Z");

test("the old ordering (planned_for ascending, first 30) hides a new plan behind 30 past plans", () => {
  const oldFirstPage = [...pastPlans, todayPlan].sort((a, b) => a.planned_for < b.planned_for ? -1 : 1).slice(0, 30);
  assert.equal(oldFirstPage.some((row) => row.id === todayPlan.id), false);
});

test("a plan for today leads the first page even with 30 older dated plans", () => {
  const page = fetchPage([...pastPlans, todayPlan], FIRST_PLAN_PAGE, 30);
  assert.equal(page.rows.length, 30);
  assert.equal(page.rows[0].id, todayPlan.id);
  assert.deepEqual(page.rows.slice(1, 4).map((row) => row.planned_for), ["2026-10-30", "2026-10-29", "2026-10-28"], "past plans follow, most recent first");
  assert.deepEqual(page.next, { segment: "past", offset: 29 });
  const second = fetchPage([...pastPlans, todayPlan], page.next, 30);
  assert.deepEqual(second.rows.map((row) => row.id), ["past-01"]);
  assert.equal(second.next, null);
});

test("segments come in order: upcoming soonest first, then undated newest first, then past most recent first", () => {
  const plans = [
    plan("past-a", "2026-11-10", "2026-11-01T00:00:00.000Z"),
    plan("undated-old", null, "2026-10-01T00:00:00.000Z"),
    plan("next-week", "2026-11-23", "2026-11-02T00:00:00.000Z"),
    plan("today-late", today, "2026-11-15T00:00:00.000Z"),
    plan("past-b", "2026-11-14", "2026-11-03T00:00:00.000Z"),
    plan("undated-new", null, "2026-11-12T00:00:00.000Z"),
    plan("today-early", today, "2026-11-14T00:00:00.000Z"),
  ];
  const [page] = fetchAll(plans, 30);
  assert.deepEqual(page.map((row) => row.id), ["today-early", "today-late", "next-week", "undated-new", "undated-old", "past-b", "past-a"]);
});

test("walking every page returns each plan once, in segment order, for any page size", () => {
  const plans = [];
  let created = 0;
  const stamp = () => `2026-09-01T00:00:${String(created++).padStart(2, "0")}.000Z`;
  for (const day of ["2026-11-16", "2026-11-16", "2026-11-17", "2026-12-01", "2026-12-01"]) plans.push(plan(`up-${plans.length}`, day, stamp()));
  for (let index = 0; index < 4; index++) plans.push(plan(`none-${plans.length}`, null, stamp()));
  for (const day of ["2026-11-15", "2026-11-15", "2026-11-01", "2026-10-20", "2026-10-20", "2026-01-05"]) plans.push(plan(`old-${plans.length}`, day, stamp()));
  const expected = fetchAll(plans, 100).flat().map((row) => row.id);
  assert.equal(expected.length, plans.length);
  for (const size of [1, 2, 3, 4, 7, 14, 15, 30]) {
    const pages = fetchAll(plans, size);
    assert.ok(pages.every((rows, index) => index === pages.length - 1 || rows.length === size), `full pages of ${size}`);
    assert.deepEqual(pages.flat().map((row) => row.id), expected, `page size ${size}`);
  }
});

test("a page that ends exactly at the end of the data has no next page", () => {
  const plans = Array.from({ length: 30 }, (_, index) => plan(`up-${index}`, "2026-11-20", `2026-09-01T00:00:${String(index).padStart(2, "0")}.000Z`));
  assert.equal(fetchPage(plans, FIRST_PLAN_PAGE, 30).next, null);
  const withOnePast = [...plans, plan("old", "2026-11-01", "2026-08-01T00:00:00.000Z")];
  const page = fetchPage(withOnePast, FIRST_PLAN_PAGE, 30);
  assert.deepEqual(page.next, { segment: "past", offset: 0 });
  assert.deepEqual(fetchPage(withOnePast, page.next, 30).rows.map((row) => row.id), ["old"]);
});

test("planPageRequests asks every remaining segment for one row more than a page", () => {
  assert.deepEqual(planPageRequests(FIRST_PLAN_PAGE, 30), [
    { segment: "upcoming", from: 0, to: 30 },
    { segment: "undated", from: 0, to: 30 },
    { segment: "past", from: 0, to: 30 },
  ]);
  assert.deepEqual(planPageRequests({ segment: "past", offset: 29 }, 30), [{ segment: "past", from: 29, to: 59 }]);
  assert.deepEqual(PLAN_SEGMENTS, ["upcoming", "undated", "past"]);
});

test("mergePlansById appends only plans that are not listed yet", () => {
  const linked = { id: "b" };
  assert.deepEqual(mergePlansById([linked, { id: "a" }], [{ id: "a" }, { id: "b" }, { id: "c" }]).map((row) => row.id), ["b", "a", "c"]);
  assert.deepEqual(mergePlansById([], [{ id: "x" }, { id: "x" }]).map((row) => row.id), ["x"]);
});

test("plan card status: a finished plan is never shown as scheduled for a day that has passed", () => {
  assert.equal(planCardStatus(null, today, null), "Draft");
  assert.equal(planCardStatus(null, today, "2026-11-10"), "Draft");
  assert.equal(planCardStatus("2026-11-20", today, null), "Scheduled");
  assert.equal(planCardStatus("2026-11-20", today, today), "Scheduled", "done early: that day is still planned");
  assert.equal(planCardStatus(today, today, null), "Scheduled");
  assert.equal(planCardStatus(today, today, today), "Done");
  assert.equal(planCardStatus("2026-11-14", today, "2026-11-14"), "Done");
  assert.equal(planCardStatus("2026-11-14", today, "2026-11-15"), "Done", "done a day late");
  assert.equal(planCardStatus("2026-11-14", today, "2026-11-13"), "Past date", "last done before that date");
  assert.equal(planCardStatus("2026-11-14", today, null), "Past date");
  assert.equal(planCardStatus("2026-11-14", today, undefined), "Past date", "unknown when the lookup is unavailable");
});
