// The exercise page's tabs in the address (?tab=) and its small texts and links.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXERCISE_TAB, EXERCISE_TABS, EXERCISE_TAB_LABELS, exerciseHref, exerciseTabFrom, isExerciseTab, searchWithTab, tabNeedsHistory,
} from "@/components/exercises/detail/detail-tabs";
import {
  addToWorkoutHref, libraryHref, muscleBrowseHref, reportProblemHref, stepsSourceText, workPerSetText, workoutRecordHref,
} from "@/components/exercises/detail/detail-text";
import { safePagePath } from "@/components/support/support-rules";

describe("exercise page tabs", () => {
  test("four tabs in the contract's order, Guide first and by default", () => {
    assert.deepEqual([...EXERCISE_TABS], ["guide", "muscles", "history", "progress"]);
    assert.deepEqual(EXERCISE_TABS.map((tab) => EXERCISE_TAB_LABELS[tab]), ["Guide", "Muscles", "History", "Progress"]);
    assert.equal(DEFAULT_EXERCISE_TAB, "guide");
  });

  test("?tab= picks a tab; anything else is the Guide", () => {
    assert.equal(exerciseTabFrom("muscles"), "muscles");
    assert.equal(exerciseTabFrom(" Progress "), "progress");
    assert.equal(exerciseTabFrom(["history", "guide"]), "history", "the first of a repeated parameter");
    for (const value of [undefined, null, "", "info", "toString", "__proto__", []]) assert.equal(exerciseTabFrom(value as string), "guide", String(value));
    assert.equal(isExerciseTab("guide"), true);
    assert.equal(isExerciseTab("Guide"), false);
    assert.equal(isExerciseTab(1), false);
  });

  test("the address keeps other parameters and leaves the default tab out", () => {
    assert.equal(searchWithTab("", "muscles"), "?tab=muscles");
    assert.equal(searchWithTab("?tab=history", "guide"), "");
    assert.equal(searchWithTab("?from=plan&tab=history", "progress"), "?from=plan&tab=progress");
    assert.equal(searchWithTab("from=plan", "guide"), "?from=plan");
    assert.equal(exerciseHref("bench_press"), "/exercises/bench_press");
    assert.equal(exerciseHref("free-exercise-db-3_4_Sit-Up", "history"), "/exercises/free-exercise-db-3_4_Sit-Up?tab=history");
  });

  test("only History and Progress read the member's sessions", () => {
    assert.deepEqual(EXERCISE_TABS.filter(tabNeedsHistory), ["history", "progress"]);
  });
});

describe("exercise page texts and links", () => {
  test("work per set: a rep range, one rep count or a time", () => {
    assert.equal(workPerSetText({ prescription_type: "reps", reps_min: 8, reps_max: 12, default_duration_seconds: null }), "8–12 reps");
    assert.equal(workPerSetText({ prescription_type: "reps", reps_min: 10, reps_max: 10, default_duration_seconds: null }), "10 reps");
    assert.equal(workPerSetText({ prescription_type: "time", reps_min: 1, reps_max: 1, default_duration_seconds: 45 }), "45 s");
    assert.equal(workPerSetText({ prescription_type: "time", reps_min: 1, reps_max: 1, default_duration_seconds: null }), "30 s");
    assert.equal(workPerSetText({ prescription_type: "time", reps_min: 1, reps_max: 1, default_duration_seconds: 600 }), "10 min");
  });

  test("the steps' source comes from the row's own attribution", () => {
    assert.equal(stepsSourceText("Free Exercise DB (Unlicense; yuhonas/free-exercise-db)"), "Steps: Free Exercise DB (Unlicense; yuhonas/free-exercise-db), public domain.");
    assert.equal(stepsSourceText("FITX exercise reference"), "Steps: FITX exercise reference.");
    assert.equal(stepsSourceText("  "), null);
    assert.equal(stepsSourceText(null), null);
  });

  test("Report a problem opens Help with the exercise page, which Help keeps as the request's page", () => {
    const href = reportProblemHref("free-exercise-db-Barbell_Deadlift");
    assert.equal(href, "/help?from=%2Fexercises%2Ffree-exercise-db-Barbell_Deadlift");
    const from = new URL(href, "https://fitx.example").searchParams.get("from");
    assert.equal(safePagePath(from), "/exercises/free-exercise-db-Barbell_Deadlift");
  });

  test("links to other pages", () => {
    assert.equal(muscleBrowseHref("middle_back"), "/exercises/muscles?muscle=middle_back");
    assert.equal(workoutRecordHref("5f1c0f3e-0000-4000-8000-000000000001"), "/workouts/history/5f1c0f3e-0000-4000-8000-000000000001");
    assert.equal(libraryHref("chest", "gym"), "/exercises?muscle=chest");
    assert.equal(libraryHref("back", "home"), "/exercises?muscle=back&context=home&doable=1");
    assert.equal(addToWorkoutHref("bench_press"), "/workouts?exercise=bench_press");
  });
});
