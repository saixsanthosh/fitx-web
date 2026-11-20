import { test } from "node:test";
import assert from "node:assert/strict";
import { localDay, readSets, setFromSummary, setResult, writeSets } from "@/lib/home-workout/log";
import type { CoachSummary } from "@/lib/form-rules/session";

const summary = (patch: Partial<CoachSummary>): CoachSummary => ({
  exerciseId: "push_up", kind: "reps", reps: 3, cleanReps: 2, partials: 1, holdSeconds: 0, positionSeconds: 0, activeSeconds: 20, unclearSeconds: 0,
  cues: [{ id: "hip_sag", text: "Hips are sagging.", count: 1 }], repLog: [{ clean: true, cues: [] }, { clean: false, cues: ["hip_sag"] }, { clean: true, cues: [] }], ...patch,
});

test("a finished set keeps its reps, form per rep and timing; an empty one is not kept", () => {
  const set = setFromSummary(summary({}), "Push-up", 100_000, "a");
  assert.equal(set?.reps, 3);
  assert.equal(set?.cleanReps, 2);
  assert.deepEqual(set?.repLog.map((rep) => rep.clean), [true, false, true]);
  assert.equal(set?.cueTexts.hip_sag, "Hips are sagging.");
  assert.equal(set?.startedAt, 80_000);
  assert.equal(setFromSummary(summary({ reps: 0, repLog: [] }), "Push-up", 1, "b"), null);
  const hold = setFromSummary(summary({ kind: "hold", reps: 0, holdSeconds: 42, positionSeconds: 50, repLog: [] }), "Plank", 100_000, "c");
  assert.equal(hold?.holdSeconds, 42);
  assert.equal(setResult(hold!), "0:42");
  assert.equal(setResult(set!), "3 reps");
});

test("today's sets survive a reload, yesterday's do not, and blocked storage is harmless", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v), removeItem: (k: string) => void values.delete(k) };
  const now = new Date(2026, 10, 20, 9).getTime();
  const set = setFromSummary(summary({}), "Push-up", now, "a")!;
  writeSets(storage, [set], now);
  assert.equal(readSets(storage, now + 3_600_000).length, 1);
  assert.equal(readSets(storage, new Date(2026, 10, 21, 9).getTime()).length, 0);
  assert.equal(localDay(now), "2026-11-20");
  writeSets(storage, [], now);
  assert.equal(values.size, 0);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readSets(blocked, now), []);
  writeSets(blocked, [set], now);
  values.set("fitx:home-workout:today", "{not json");
  assert.deepEqual(readSets(storage, now), []);
});
