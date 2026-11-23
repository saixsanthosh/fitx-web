import { test } from "node:test";
import assert from "node:assert/strict";
import { FORM_CHECK_PATH, formCheckHref, legacyFormCheckTarget } from "@/lib/home-workout/route";
import { FEATURE_NAMES, featureForPath } from "@/lib/platform/settings";

test("AI Form Check lives under Workouts", () => {
  assert.equal(FORM_CHECK_PATH, "/workouts/form-check");
});

test("an entry link opens the exercise it was given, by camera rule id or exercise_library id", () => {
  assert.equal(formCheckHref(), "/workouts/form-check");
  assert.equal(formCheckHref(""), "/workouts/form-check");
  assert.equal(formCheckHref("push_up"), "/workouts/form-check?exercise=push_up");
  assert.equal(formCheckHref("free-exercise-db-Pushups"), "/workouts/form-check?exercise=push_up");
  assert.equal(formCheckHref("free-exercise-db-Dumbbell_Bicep_Curl"), "/workouts/form-check?exercise=biceps_curl");
});

test("an exercise the camera can't analyse gets no link at all", () => {
  assert.equal(formCheckHref("free-exercise-db-Barbell_Bench_Press_-_Medium_Grip"), null);
  assert.equal(formCheckHref("not-an-exercise"), null);
});

test("old /home-workout and /form-coach addresses keep every query parameter", () => {
  assert.equal(legacyFormCheckTarget({}), "/workouts/form-check");
  assert.equal(legacyFormCheckTarget({ exercise: "wall_sit" }), "/workouts/form-check?exercise=wall_sit");
  assert.equal(legacyFormCheckTarget({ exercise: "push_up", from: ["a", "b"], gone: undefined }), "/workouts/form-check?exercise=push_up&from=a&from=b");
  assert.equal(legacyFormCheckTarget({ exercise: "a b&c" }), "/workouts/form-check?exercise=a+b%26c");
});

test("the AI Form Check switch closes the new page and the old address, and nothing else under Workouts", () => {
  assert.equal(FEATURE_NAMES.home_workout, "AI Form Check");
  assert.equal(featureForPath("/workouts/form-check"), "home_workout");
  assert.equal(featureForPath("/home-workout"), "home_workout");
  assert.equal(featureForPath("/workouts"), null);
  assert.equal(featureForPath("/workouts/active"), null);
  assert.equal(featureForPath("/workouts/form-checkup"), null);
});
