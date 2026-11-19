import { test } from "node:test";
import assert from "node:assert/strict";
import { pickToday, type TodayCandidate } from "@/app/(dashboard)/workouts/_lib/today-pick";

const TODAY = "2026-11-19";
function plan(id: string, planned_for: string | null, last_done_key: string | null = null): TodayCandidate {
  return { id, title: id, planned_for, last_done_key };
}

test("today's programme day comes before an own plan on the same day", () => {
  const pick = pickToday(TODAY, [plan("prog", TODAY)], [plan("own", TODAY)]);
  assert.deepEqual(pick.kind === "today" && [pick.plan.id, pick.programme], ["prog", true]);
});

test("a finished programme day is skipped even if done before its date; an own plan done today is skipped", () => {
  const pick = pickToday(TODAY, [plan("prog", TODAY, "2026-11-18")], [plan("own", TODAY, TODAY), plan("later", "2026-11-21")]);
  assert.equal(pick.kind, "next");
  assert.equal(pick.kind === "next" && pick.plan.id, "later");
});

test("an own plan finished before its date still counts as to do", () => {
  const pick = pickToday(TODAY, [], [plan("own", TODAY, "2026-11-17")]);
  assert.equal(pick.kind === "today" && pick.plan.id, "own");
});

test("the soonest later day is next; drafts and past dates are never picked", () => {
  const pick = pickToday(TODAY, [plan("p2", "2026-11-23")], [plan("draft", null), plan("past", "2026-11-10"), plan("o1", "2026-11-21"), plan("o0", "2026-11-22")]);
  assert.equal(pick.kind === "next" && pick.plan.id, "o1");
});

test("on a tie for the next day the programme day comes first", () => {
  const pick = pickToday(TODAY, [plan("prog", "2026-11-20")], [plan("own", "2026-11-20")]);
  assert.deepEqual(pick.kind === "next" && [pick.plan.id, pick.programme], ["prog", true]);
});

test("nothing planned ahead gives none", () => {
  assert.deepEqual(pickToday(TODAY, [], [plan("past", "2026-11-01")]), { kind: "none" });
});
