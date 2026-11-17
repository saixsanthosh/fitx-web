// The live workout's progress: the set being performed, what is left, what comes next and the rest timer.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  REST_MAX_SECONDS, adjustRest, describeNextStep, exerciseAfterTick, exerciseProgress, formatCountdown, formatKg, formatRest, nextExerciseWithOpenSets, restFraction,
  restRemaining, sessionProgress, sessionTally, setHeadline, setTarget, setsLeftLabel, startRest, stepAfterCurrentSet, stepAfterRest, stepValue, timerSecondsDone,
  updateSet, workTarget,
  type ProgressExercise, type ProgressSet,
} from "@/app/(dashboard)/workouts/active/_lib/session-progress";

const DONE = "2026-11-18T09:00:00.000Z";
const set = (n: number, done = false, target: number | null = 10): ProgressSet => ({ id: `s${n}`, set_number: n, completed_at: done ? DONE : null, target_reps: target });
// Sets may carry the page's typed weight (draftWeight), which "Up next" reads.
const exercise = (id: string, sets: Array<ProgressSet & { draftWeight?: string }>, extra: Partial<ProgressExercise> = {}): ProgressExercise => ({
  id, name: id, exercise_id: id, reps_min: 8, reps_max: 12, rest_seconds: 90, target_weight_kg: null, target_duration_seconds: null, sets, ...extra,
});

describe("the set being performed", () => {
  test("the first set not ticked, in set order: Set 2 of 4, 3 sets left", () => {
    const progress = exerciseProgress({ sets: [set(3), set(1, true), set(4), set(2)] });
    assert.deepEqual([progress.total, progress.done, progress.left, progress.position, progress.current?.id], [4, 1, 3, 2, "s2"]);
    assert.equal(setHeadline(progress), "Set 2 of 4");
    assert.equal(setsLeftLabel(progress), "3 sets left");
  });

  test("a set ticked out of order still leaves the earliest open set current", () => {
    const progress = exerciseProgress({ sets: [set(1, true), set(2), set(3, true)] });
    assert.deepEqual([progress.position, progress.current?.id, progress.left], [2, "s2", 1]);
    assert.equal(setsLeftLabel(progress), "Last set");
  });

  test("every set done, one set, no sets", () => {
    assert.equal(setHeadline(exerciseProgress({ sets: [set(1, true), set(2, true)] })), "All 2 sets done");
    assert.equal(setHeadline(exerciseProgress({ sets: [set(1, true)] })), "The set is done");
    assert.equal(setsLeftLabel(exerciseProgress({ sets: [set(1, true)] })), "");
    const none = exerciseProgress({ sets: [] });
    assert.deepEqual([none.total, none.position, none.current], [0, null, null]);
    assert.equal(setHeadline(none), "No sets yet");
  });

  test("the whole session: sets done and left, exercises complete", () => {
    const progress = sessionProgress([exercise("a", [set(1, true), set(2, true)]), exercise("b", [set(1, true), set(2)]), exercise("c", [])]);
    assert.deepEqual(progress, { setsDone: 3, setsTotal: 4, setsLeft: 1, exercisesDone: 1, exercisesTotal: 3 });
  });
});

describe("what comes next", () => {
  const session = [
    exercise("bench", [set(1, true), set(2), set(3)]),
    exercise("row", [set(1), set(2)]),
    exercise("curl", [set(1, true)]),
  ];

  test("after the current set: the next set of this exercise", () => {
    const next = stepAfterCurrentSet(session, 0);
    assert.equal(next.kind, "set");
    assert.deepEqual(next.kind === "set" ? [next.exerciseIndex, next.set.id, next.position, next.total] : null, [0, "s3", 3, 3]);
  });

  test("the last open set of an exercise is followed by the next exercise with sets to do", () => {
    const last = [exercise("bench", [set(1, true), set(2)]), exercise("row", [set(1), set(2)])];
    assert.deepEqual(stepAfterCurrentSet(last, 0), { kind: "exercise", exerciseIndex: 1, left: 2 });
  });

  test("skipped exercises earlier in the list come back round; the final set leads to finish", () => {
    const skipped = [exercise("bench", [set(1)]), exercise("row", [set(1, true)]), exercise("curl", [set(1)])];
    assert.deepEqual(stepAfterCurrentSet(skipped, 2), { kind: "exercise", exerciseIndex: 0, left: 1 });
    assert.equal(nextExerciseWithOpenSets(skipped, 2), 0);
    assert.equal(nextExerciseWithOpenSets(skipped, 0), 2, "forward first");
    const final = [exercise("bench", [set(1, true)]), exercise("row", [set(1)])];
    assert.deepEqual(stepAfterCurrentSet(final, 1), { kind: "finish" });
  });

  test("after rest: the current exercise's open set, else another exercise, else finish", () => {
    const rest = stepAfterRest(session, 0);
    assert.deepEqual(rest.kind === "set" ? [rest.set.id, rest.position] : null, ["s2", 2]);
    const doneHere = [exercise("bench", [set(1, true)]), exercise("row", [set(1)])];
    assert.deepEqual(stepAfterRest(doneHere, 0), { kind: "exercise", exerciseIndex: 1, left: 1 });
    assert.deepEqual(stepAfterRest([exercise("bench", [set(1, true)])], 0), { kind: "finish" });
    assert.deepEqual(stepAfterRest([], 0), { kind: "none" });
    assert.deepEqual(stepAfterRest([exercise("empty", [])], 0), { kind: "none" }, "no sets anywhere: nothing to finish yet");
  });

  test("after a tick the page stays while the exercise has sets, else moves on", () => {
    assert.equal(exerciseAfterTick(session, 0), 0);
    assert.equal(exerciseAfterTick([exercise("a", [set(1, true)]), exercise("b", [set(1)])], 0), 1);
    assert.equal(exerciseAfterTick([exercise("a", [set(1, true)]), exercise("b", [set(1, true)])], 0), 0, "nothing left: it stays");
    assert.equal(exerciseAfterTick([], 3), 0);
  });
});

describe("up next in words", () => {
  test("the next set with its target and the weight typed for it", () => {
    const bench = exercise("Bench press", [set(1, true), { ...set(2), draftWeight: "62.5" }, set(3)]);
    assert.deepEqual(describeNextStep(stepAfterRest([bench], 0), [bench]), { title: "Set 2 of 3", detail: "10 reps · 62.5 kg" });
    assert.deepEqual(describeNextStep(stepAfterCurrentSet([bench], 0), [bench]), { title: "Set 3 of 3", detail: "10 reps" }, "no weight typed: none is claimed");
  });

  test("the next exercise, a timed set, finish and nothing", () => {
    const row = exercise("Bent-over row", [set(1), set(2), set(3)], { target_weight_kg: 40 });
    const plank = exercise("Plank", [set(1, false, null)], { target_duration_seconds: 45, reps_min: 1, reps_max: 1 });
    const done = exercise("Curl", [set(1, true)]);
    assert.deepEqual(describeNextStep({ kind: "exercise", exerciseIndex: 1, left: 3 }, [done, row]), { title: "Bent-over row", detail: "3 sets · 8–12 reps · 40 kg" });
    assert.deepEqual(describeNextStep(stepAfterRest([plank], 0), [plank]), { title: "Set 1 of 1", detail: "45 s" });
    assert.deepEqual(describeNextStep({ kind: "finish" }, [done]), { title: "Finish the workout", detail: "Every set is done" });
    assert.equal(describeNextStep({ kind: "none" }, []), null);
    assert.equal(describeNextStep({ kind: "exercise", exerciseIndex: 5, left: 1 }, [done]), null);
  });
});

describe("targets", () => {
  test("work per set and the current set's own target", () => {
    assert.equal(workTarget({ reps_min: 8, reps_max: 10, target_duration_seconds: null }), "8–10 reps");
    assert.equal(workTarget({ reps_min: 10, reps_max: 10, target_duration_seconds: null }), "10 reps");
    assert.equal(workTarget({ reps_min: 1, reps_max: 1, target_duration_seconds: 45 }), "45 s");
    assert.deepEqual(setTarget({ target_duration_seconds: null }, set(1, false, 9)), { kind: "reps", value: 9 });
    assert.deepEqual(setTarget({ target_duration_seconds: 30 }, set(1, false, null)), { kind: "seconds", value: 30 });
    assert.equal(setTarget({ target_duration_seconds: null }, set(1, false, null)), null, "no target is shown when none was set");
    assert.equal(setTarget({ target_duration_seconds: null }, null), null);
  });

  test("weights read as typed", () => {
    assert.deepEqual([40, 42.5, 12.255, 0].map(formatKg), ["40", "42.5", "12.26", "0"]);
  });
});

describe("rest timer", () => {
  const now = 1_000_000;

  test("a rest starts from the planned rest, clamped; time left counts down in whole seconds", () => {
    assert.deepEqual(startRest(90, now), { endsAt: now + 90_000, totalSeconds: 90 });
    assert.deepEqual(startRest(null, now), { endsAt: now + 90_000, totalSeconds: 90 }, "unknown rest: 90 s");
    assert.equal(startRest(5000, now).totalSeconds, REST_MAX_SECONDS);
    assert.equal(restRemaining({ endsAt: now + 89_400 }, now), 90, "a part second still shows");
    assert.equal(restRemaining({ endsAt: now - 1 }, now), 0);
    assert.equal(restRemaining(null, now), 0);
  });

  test("−15 s and +15 s move the time left and the total; never past 10 minutes; 0 ends the rest", () => {
    const rest = { endsAt: now + 60_000, totalSeconds: 90 };
    assert.deepEqual(adjustRest(rest, 15, now), { endsAt: now + 75_000, totalSeconds: 105 });
    assert.deepEqual(adjustRest(rest, -15, now), { endsAt: now + 45_000, totalSeconds: 75 });
    assert.equal(adjustRest({ endsAt: now + 10_000, totalSeconds: 90 }, -15, now), null, "less than 15 s left: the rest ends");
    const long = adjustRest({ endsAt: now + 595_000, totalSeconds: 600 }, 15, now);
    assert.equal(long && restRemaining(long, now), REST_MAX_SECONDS);
    assert.ok(long && long.totalSeconds >= REST_MAX_SECONDS);
  });

  test("the ring's fill and the countdown text", () => {
    assert.equal(restFraction(45, 90), 0.5);
    assert.equal(restFraction(0, 90), 0);
    assert.equal(restFraction(120, 90), 1);
    assert.equal(restFraction(10, 0), 0);
    assert.deepEqual([90, 5, 0, 59.2, 3725].map(formatCountdown), ["1:30", "0:05", "0:00", "1:00", "1:02:05"]);
    assert.deepEqual([45, 90, 119, 120, 150].map(formatRest), ["45 s", "90 s", "119 s", "2 min", "2 min 30 s"]);
  });
});

describe("number steppers", () => {
  test("weights step onto the 2.5 kg grid, reps by one, within limits", () => {
    assert.equal(stepValue("40", 2.5, { max: 2000 }), "42.5");
    assert.equal(stepValue("41", 2.5, { max: 2000 }), "42.5");
    assert.equal(stepValue("41", -2.5, { max: 2000 }), "40");
    assert.equal(stepValue("", 2.5, { max: 2000 }), "2.5");
    assert.equal(stepValue("0", -2.5, { max: 2000 }), "0");
    assert.equal(stepValue("1999", 2.5, { max: 2000 }), "2000");
    assert.equal(stepValue("10", 1, { max: 500, decimals: 0 }), "11");
    assert.equal(stepValue("abc", 1, { max: 500, decimals: 0 }), "1");
    assert.equal(stepValue("30", -5, { max: 86400, decimals: 0 }), "25");
  });
});

describe("a save that returns late", () => {
  test("only the saved set changes; ticks and typing made meanwhile stay", () => {
    type Row = ProgressSet & { draftReps: string };
    const typed = (n: number, done: boolean, draftReps: string): Row => ({ ...set(n, done), draftReps });
    // Set 2 was ticked and set 3 typed while set 1's save was in flight.
    const now = [{ id: "a", sets: [typed(1, false, "8"), typed(2, true, "8"), typed(3, false, "6")] }, { id: "b", sets: [typed(1, false, "")] }];
    const next = updateSet(now, "a", "s1", (row) => ({ ...row, completed_at: DONE, draftReps: "8" }));
    assert.deepEqual(next[0].sets.map((row) => [row.id, Boolean(row.completed_at), row.draftReps]), [["s1", true, "8"], ["s2", true, "8"], ["s3", false, "6"]]);
    assert.equal(next[1], now[1], "other exercises are kept as they are");
    assert.equal(now[0].sets[0].completed_at, null, "the input is not changed");
    assert.equal(sessionProgress(next).setsLeft, 2);
  });
});

describe("set timer", () => {
  test("the seconds held so far, at least 1 and never more than the timer was set for", () => {
    const timer = { startedAt: 1_000_000, seconds: 60 };
    assert.equal(timerSecondsDone(timer, 1_000_000 + 40_200), 40);
    assert.equal(timerSecondsDone(timer, 1_000_000 + 100), 1);
    assert.equal(timerSecondsDone(timer, 1_000_000 + 75_000), 60);
  });
});

describe("the live tally", () => {
  const stats = (extra: Partial<{ completedSets: number; volumeKg: number | null; timedSets: number; timedSeconds: number }>) => ({ completedSets: 0, volumeKg: null, timedSets: 0, timedSeconds: 0, ...extra });
  test("body-weight work has no kilograms; short timed work reads in minutes and seconds", () => {
    assert.equal(sessionTally(stats({ completedSets: 4, timedSets: 1, timedSeconds: 25 }), true, "en-GB"), "4 completed sets · 0:25 timed");
    assert.equal(sessionTally(stats({ completedSets: 1, volumeKg: 1200.4, timedSets: 1, timedSeconds: 90 }), true, "en-GB"), "1 completed set · 1,200 kg logged · 1:30 timed");
  });
  test("the timed part only when timed sets can be stored and one is logged", () => {
    assert.equal(sessionTally(stats({ completedSets: 2, volumeKg: 480, timedSets: 1, timedSeconds: 30 }), false, "en-GB"), "2 completed sets · 480 kg logged");
    assert.equal(sessionTally(stats({}), true, "en-GB"), "0 completed sets");
  });
});
