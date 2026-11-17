// "What should I improve next?": each rule fires only on real logs above its threshold and shows its numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "@/lib/domain/day-keys";
import { improveNext, proteinDays, pushPullSets, shortDay, type InsightInput } from "@/lib/domain/insights";
import { mealTotalsByDay } from "@/lib/domain/meal-totals";
import { at, exercise, session } from "./support/training";

const TODAY = "2026-11-18"; // a Wednesday
const ago = (days: number) => addDays(TODAY, -days);

function input(overrides: Partial<InsightInput> = {}): InsightInput {
  return { today: TODAY, sessions: [], activityStarts: [], activitiesFailed: false, foodDays: new Map(), proteinTarget: null, ...overrides };
}

test("with too little logged, nothing is suggested and the reason is 'not enough data'", () => {
  assert.deepEqual(improveNext(input()), { status: "not_enough_data", insights: [] });
  const one = improveNext(input({ sessions: [session(ago(2), [exercise("squat", ago(2))])] }));
  assert.deepEqual(one, { status: "not_enough_data", insights: [] });
});

test("a muscle trained in the weeks before but not in the last 7 days is pointed out, with its numbers", () => {
  const sessions = [
    session(ago(30), [exercise("leg_curl", ago(30), 3)]),
    session(ago(16), [exercise("leg_curl", ago(16), 3)]),
    session(ago(9), [exercise("rdl", ago(9), 2)]),
    session(ago(2), [exercise("bench_press", ago(2), 3)]),
  ];
  const result = improveNext(input({ sessions }));
  const gap = result.insights.find((insight) => insight.id === "muscle_gap:hamstrings");
  assert.ok(gap, JSON.stringify(result));
  assert.equal(gap.title, "Hamstrings: no sets in the last 7 days");
  assert.match(gap.detail, /^8 direct sets in 3 of the 4 weeks before, the last on /);
  assert.ok(gap.detail.includes(shortDay(ago(9))));
  assert.equal(gap.href, "/exercises?muscle=hamstrings");

  const assisted = [...sessions, session(ago(1), [exercise("squat", ago(1), 3)])];
  assert.equal(improveNext(input({ sessions: assisted })).insights.some((insight) => insight.id === "muscle_gap:hamstrings"), false, "squats worked them as an assisting muscle in the last 7 days");

  const resting = sessions.slice(0, 3);
  assert.equal(improveNext(input({ sessions: resting })).insights.some((insight) => insight.kind === "muscle_gap"), false, "no training at all in the last 7 days is a break, not a muscle gap");

  const once = [session(ago(20), [exercise("leg_curl", ago(20), 6)]), session(ago(2), [exercise("bench_press", ago(2), 3)])];
  assert.equal(improveNext(input({ sessions: once })).insights.some((insight) => insight.kind === "muscle_gap"), false, "one week of hamstring work is not a habit yet");
});

test("abandoned workouts and unticked sets never count toward a muscle", () => {
  const sessions = [
    session(ago(30), [exercise("leg_curl", ago(30), 3)], "abandoned"),
    session(ago(16), [exercise("leg_curl", ago(16), 3, { done: false })]),
    session(ago(2), [exercise("bench_press", ago(2), 3)]),
    session(ago(3), [exercise("bench_press", ago(3), 3)]),
  ];
  assert.equal(improveNext(input({ sessions })).insights.some((insight) => insight.kind === "muscle_gap"), false);
});

test("a clear push and pull imbalance over 4 weeks is named; balanced training is not", () => {
  const pushy = [ago(1), ago(5), ago(9), ago(13), ago(17), ago(21)].map((day) => session(day, [exercise("bench_press", day, 3), exercise("press", day, 3)]));
  pushy.push(session(ago(8), [exercise("row", ago(8), 3)]));
  assert.deepEqual(pushPullSets(pushy, ago(27), TODAY), { push: 18, pull: 3 }, "shoulder presses count on neither side");
  const result = improveNext(input({ sessions: pushy }));
  const imbalance = result.insights.find((insight) => insight.kind === "push_pull");
  assert.ok(imbalance);
  assert.equal(imbalance.title, "More pushing than pulling");
  assert.equal(imbalance.detail, "In the last 4 weeks: 18 push sets (chest and triceps) and 3 pull sets (back and biceps).");
  assert.equal(imbalance.href, "/exercises?muscle=back");

  const balanced = [ago(1), ago(8), ago(15)].map((day) => session(day, [exercise("bench_press", day, 3), exercise("row", day, 3), exercise("pull_up", day, 2)]));
  assert.equal(improveNext(input({ sessions: balanced })).insights.some((insight) => insight.kind === "push_pull"), false);
  const small = [session(ago(1), [exercise("bench_press", ago(1), 6)]), session(ago(2), [exercise("bench_press", ago(2), 4)])];
  assert.equal(improveNext(input({ sessions: small })).insights.some((insight) => insight.kind === "push_pull"), false, "10 sets are too few to call");
});

test("protein under the target on most logged days is pointed out; incomplete days are not judged", () => {
  const foodDays = mealTotalsByDay([
    { date: ago(1), protein: 70 },
    { date: ago(2), protein: 60 },
    { date: ago(3), protein: 110 },
    { date: ago(4), protein: 50 },
    { date: ago(5), protein: 40 },
    { date: ago(5), protein: null },
    { date: TODAY, protein: 5 },
  ]);
  assert.deepEqual(proteinDays(foodDays, TODAY, 100), { logged: 5, met: 1, under: 3, unclear: 1, average: 72.5 });
  const result = improveNext(input({ foodDays, proteinTarget: { grams: 100, estimate: false, label: "your daily goal" } }));
  const protein = result.insights.find((insight) => insight.kind === "protein");
  assert.ok(protein);
  assert.equal(protein.detail, "Under 100 g on 3 of the 4 days you logged food in the last 7 days. Those days averaged 73 g. 1 more day had foods without a protein value, so it isn't counted.");
  assert.equal(protein.basis, "Measured against your daily goal of 100 g. Foods without a protein value are left out.");
  const estimated = improveNext(input({ foodDays, proteinTarget: { grams: 100, estimate: true, label: "your estimated target" } })).insights.find((insight) => insight.kind === "protein");
  assert.match(estimated?.basis ?? "", /estimated target of 100 g/);
  assert.equal(improveNext(input({ foodDays, proteinTarget: null })).insights.some((insight) => insight.kind === "protein"), false, "no target, no judgement");
  assert.equal(improveNext(input({ foodDays, proteinTarget: { grams: 60, estimate: false, label: "your target" } })).insights.some((insight) => insight.kind === "protein"), false);
});

test("nothing logged this week is pointed out only when something by now is usual", () => {
  // Workouts on the Mondays 2 and 4 weeks back, and a walk on the Tuesday 3 weeks back: 3 of the 4 weeks.
  const usual = [16, 30].map((days) => session(ago(days), [exercise("squat", ago(days))]));
  const result = improveNext(input({ sessions: usual, activityStarts: [at(ago(22), 7)] }));
  const nudge = result.insights.find((insight) => insight.kind === "consistency");
  assert.ok(nudge, JSON.stringify(result));
  assert.equal(nudge.detail, "By Wednesday in the last 4 weeks you had logged 1, 1, 1 and 0 workouts or activities. This week: none so far.");
  assert.equal(result.insights[0].kind, "consistency", "it leads the list");

  const workoutsOnly = improveNext(input({ sessions: usual, activityStarts: null })).insights.find((insight) => insight.kind === "consistency");
  assert.equal(workoutsOnly, undefined, "without activities only 2 of the 4 weeks had something by Wednesday");
  const later = improveNext(input({ sessions: [...usual, session(ago(5), [exercise("squat", ago(5))])], activityStarts: [] }));
  assert.equal(later.insights.some((insight) => insight.kind === "consistency"), false, "last week's Friday workout was after this point of the week");

  const thisWeek = improveNext(input({ sessions: usual, activityStarts: [at(ago(22), 7), at(ago(1), 7)] }));
  assert.equal(thisWeek.insights.some((insight) => insight.kind === "consistency"), false, "an activity this week counts");
});

test("nothing logged this week is not said when activities could not be read", () => {
  // Workouts in 3 of the 4 weeks before, none this week: the nudge would fire on workouts alone.
  const usual = [16, 23, 30].map((days) => session(ago(days), [exercise("squat", ago(days))]));
  assert.ok(improveNext(input({ sessions: usual, activityStarts: null })).insights.some((insight) => insight.kind === "consistency"), "activities unavailable on this database: workouts decide");
  const failed = improveNext(input({ sessions: usual, activityStarts: null, activitiesFailed: true }));
  assert.equal(failed.insights.some((insight) => insight.kind === "consistency"), false, "runs this week may be in the activities that failed to load");
});

test("enough data with nothing to point out says so instead of inventing a suggestion", () => {
  const balanced = [ago(1), ago(3), ago(8), ago(10), ago(15), ago(22), ago(29)].map((day) => session(day, [exercise("bench_press", day, 3), exercise("row", day, 3), exercise("squat", day, 3), exercise("rdl", day, 2)]));
  const result = improveNext(input({ sessions: balanced }));
  assert.equal(result.status, "nothing_to_flag", JSON.stringify(result.insights));
  assert.deepEqual(result.insights, []);
});
