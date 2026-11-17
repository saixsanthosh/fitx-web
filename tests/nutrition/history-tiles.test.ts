import { test } from "node:test";
import assert from "node:assert/strict";
import { unknownAverageNote } from "@/components/nutrition/history-tiles";
import { buildHistory, lastDays, type HistoryEntry } from "@/lib/domain/nutrition-history";

const dates = lastDays(new Date(2026, 10, 18), 7);
const entry = (date: string, protein: number | null, carbs: number | null, fat: number | null): HistoryEntry => ({ date, calories: 500, protein, carbs, fat, estimated: false });

test("a tile whose averages are all known has no unknown note", () => {
  const history = buildHistory([entry("2026-11-18", 20, 60, 10)], dates, null);
  assert.equal(unknownAverageNote(history.averages, ["protein"]), null);
  assert.equal(unknownAverageNote(history.averages, ["carbs", "fat"]), null);
});

test("a macro no logged day had a value for is named, not shown as a number", () => {
  const history = buildHistory([entry("2026-11-18", null, 35, null), entry("2026-11-17", null, 40, null)], dates, null);
  assert.equal(history.averages?.protein, null);
  assert.equal(unknownAverageNote(history.averages, ["protein"]), "No logged day has a protein value.");
  assert.equal(unknownAverageNote(history.averages, ["carbs", "fat"]), "No logged day has a fat value.");
});

test("both macros on a shared tile are named when neither is known", () => {
  assert.equal(unknownAverageNote({ carbs: null, fat: null }, ["carbs", "fat"]), "No logged day has a carbs or fat value.");
  assert.equal(unknownAverageNote({ carbs: 0, fat: 12 }, ["carbs", "fat"]), null, "a real 0 g average is a known value");
});

test("no averages at all (nothing logged) gives no note", () => {
  assert.equal(unknownAverageNote(null, ["protein"]), null);
  assert.equal(unknownAverageNote(undefined, ["protein"]), null);
});
