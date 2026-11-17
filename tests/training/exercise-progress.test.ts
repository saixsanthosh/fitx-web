// What the exercise page's History and Progress tabs show, from logged sessions only (exercise-history.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ExerciseSession, HistorySet } from "@/lib/training/exercise-history";
import {
  HISTORY_LOADS, bestSetText, formatDuration, formatKg, historyBasis, latestPoints, nextHistoryLoad, overallBest, pagesAfterLoadMore, setResult, topSetOf, volumeSeries,
} from "@/lib/training/exercise-progress";
import { estimateOneRepMax } from "@/lib/training/one-rep-max";

const at = (day: number) => new Date(Date.UTC(2026, 10, day, 9, 0)).toISOString();
const set = (reps: number | null, weightKg: number, extra: Partial<HistorySet> = {}): HistorySet => ({ setNumber: null, reps, weightKg, durationSeconds: null, completedAt: at(10), ...extra });
const session = (sessionId: string, day: number, sets: HistorySet[], timed = false): ExerciseSession =>
  ({ sessionId, sessionName: `Session ${sessionId}`, startedAt: at(day), completedAt: at(day), exerciseId: "bench_press", exerciseName: "Bench", timed, sets });

describe("formatting", () => {
  test("durations and kilograms", () => {
    assert.deepEqual([0, 45, 60, 90, 605].map(formatDuration), ["0 s", "45 s", "1 min", "1 min 30 s", "10 min 5 s"]);
    assert.deepEqual([60, 62.5, 62.25, 1440, 12345.67].map(formatKg), ["60 kg", "62.5 kg", "62.3 kg", "1,440 kg", "12,345.7 kg"]);
  });

  test("a set reads as weight × reps, reps, or time; timed movements count their seconds", () => {
    assert.equal(setResult(set(8, 62.5), false), "62.5 kg × 8");
    assert.equal(setResult(set(12, 0), false), "12 reps");
    assert.equal(setResult(set(1, 0), false), "1 rep");
    assert.equal(setResult(set(null, 0, { durationSeconds: 45 }), true), "45 s");
    assert.equal(setResult(set(1, 20, { durationSeconds: 30 }), true), "30 s", "a hold with reps typed in is still a hold");
    assert.equal(setResult(set(null, 0, { durationSeconds: 90 }), false), "1 min 30 s", "seconds only, on a rep movement");
    assert.equal(setResult(set(20, 0), true), "20 reps", "a timed movement logged with reps only shows them as logged");
  });
});

describe("best sets", () => {
  test("the session's top set is the very set object in its list", () => {
    const heavy = set(5, 100);
    const day = session("s1", 3, [set(8, 80), heavy, set(10, 60)]);
    assert.equal(topSetOf(day), heavy);
    assert.equal(topSetOf(session("empty", 4, [])), null);
  });

  test("overall: weighted beats body weight beats time; the heaviest, then most reps; the first session on a tie", () => {
    const sessions = [
      session("late", 20, [set(8, 100)]),
      session("early", 5, [set(8, 100)]),
      session("light", 12, [set(15, 60)]),
      session("bodyweight", 13, [set(30, 0)]),
    ];
    const best = overallBest(sessions);
    assert.equal(best?.session.sessionId, "early");
    assert.equal(best && bestSetText(best.best), "100 kg × 8");
    assert.equal(best?.best.kind === "weighted" ? best.best.oneRepMaxKg : null, estimateOneRepMax(100, 8));
    assert.equal(overallBest([session("a", 1, [set(12, 0)]), session("b", 2, [set(15, 0)])])?.session.sessionId, "b");
    assert.equal(bestSetText(overallBest([session("h", 1, [set(null, 0, { durationSeconds: 65 })], true)])!.best), "1 min 5 s");
    assert.equal(overallBest([]), null);
    assert.equal(overallBest([session("none", 1, [])]), null);
  });
});

describe("series", () => {
  test("volume: kilograms lifted per session with a weighted lift, oldest first; body weight and holds never count as 0 kg", () => {
    const points = volumeSeries([
      session("s3", 17, [set(5, 100), set(5, 100)]),
      session("s1", 3, [set(8, 62.5)]),
      session("bw", 10, [set(20, 0)]),
      session("hold", 11, [set(null, 0, { durationSeconds: 60 })], true),
    ]);
    assert.deepEqual(points.map((point) => [point.sessionId, point.value]), [["s1", 500], ["s3", 1000]]);
  });

  test("latest points keep the order", () => {
    const points = [1, 2, 3, 4].map((value) => ({ sessionId: String(value), startedAt: at(value), value }));
    assert.deepEqual(latestPoints(points, 2).map((point) => point.value), [3, 4]);
    assert.deepEqual(latestPoints(points, 9).map((point) => point.value), [1, 2, 3, 4]);
    assert.deepEqual(latestPoints(points, 0), []);
  });
});

describe("how much history is read", () => {
  test("the basis says when older sessions may exist", () => {
    assert.deepEqual(historyBasis(1, 40), { capped: false, text: "Based on your 1 completed session with this exercise." });
    assert.deepEqual(historyBasis(12, 40), { capped: false, text: "Based on all 12 of your completed sessions with this exercise." });
    assert.deepEqual(historyBasis(40, 40), { capped: true, text: "Based on your latest 40 completed sessions with this exercise." });
  });

  test("a read cut off before the oldest rows is never called the whole history, however few sessions it found", () => {
    assert.deepEqual(historyBasis(9, 40, true), { capped: true, text: "Based on your latest 9 completed sessions with this exercise." });
    assert.deepEqual(historyBasis(1, 40, true), { capped: true, text: "Based on your latest completed session with this exercise." });
    assert.equal(historyBasis(9, 40, false).capped, false, "fewer than asked for, not cut off: the whole history");
  });

  test("a larger read follows the first, then none", () => {
    assert.equal(nextHistoryLoad(HISTORY_LOADS[0]), HISTORY_LOADS[1]);
    assert.equal(nextHistoryLoad(HISTORY_LOADS[HISTORY_LOADS.length - 1]), null);
    assert.ok(HISTORY_LOADS[HISTORY_LOADS.length - 1] <= 100, "exercise-history reads at most 200 session rows, about 100 sessions");
  });

  test("a larger read moves History on one page, however many times a failed read is tried again", () => {
    let pages = 4;
    pages = pagesAfterLoadMore(pages, false);
    assert.equal(pages, 5);
    pages = pagesAfterLoadMore(pages, true);
    pages = pagesAfterLoadMore(pages, true);
    assert.equal(pages, 5, "retries keep the next ten sessions, not 70 at once");
  });
});
