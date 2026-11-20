import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { cameraFitsSet, cameraRuleFor, EXERCISE_RULES, getExerciseRule, normaliseExerciseName } from "@/lib/form-rules/catalog";
import type { Condition, PhaseSpec } from "@/lib/form-rules/types";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../supabase/migrations");

test("the fourteen camera exercises are listed in order", () => {
  assert.deepEqual(EXERCISE_RULES.map((rule) => rule.id), [
    "push_up", "bodyweight_squat", "split_squat", "glute_bridge", "plank", "jumping_jack",
    "reverse_lunge", "high_knees", "mountain_climber", "side_plank", "wall_sit", "superman", "shoulder_press", "biceps_curl",
  ]);
  assert.equal(new Set(EXERCISE_RULES.map((rule) => rule.id)).size, EXERCISE_RULES.length);
});

test("every condition, cue and progress bar reads a metric the rule defines", () => {
  for (const rule of EXERCISE_RULES) {
    const used: Condition[] = [...rule.posture, ...rule.cues.flatMap((cue) => cue.when)];
    if (rule.motion.kind === "reps") {
      const m = rule.motion;
      used.push(...m.start.enter, ...m.start.exit, ...m.target.enter, ...m.target.exit);
      assert.ok(rule.metrics[m.progress.metric], `${rule.id}: progress metric ${m.progress.metric}`);
    } else {
      used.push(...rule.motion.form);
    }
    for (const condition of used) assert.ok(rule.metrics[condition.metric], `${rule.id}: unknown metric ${condition.metric}`);
  }
});

/** For each metric in both lists, leaving a position must need a move past where entering it did. */
function assertHysteresis(id: string, name: string, phase: PhaseSpec) {
  for (const enter of phase.enter) {
    const exit = phase.exit.find((condition) => condition.metric === enter.metric);
    assert.ok(exit, `${id} ${name}: no exit for ${enter.metric}`);
    assert.notEqual(exit.op, enter.op, `${id} ${name}: ${enter.metric} exits the same way it enters`);
    const gap = enter.op === "<=" ? exit.value - enter.value : enter.value - exit.value;
    assert.ok(gap > 0, `${id} ${name}: ${enter.metric} has no hysteresis gap`);
  }
}

test("every rep threshold has hysteresis, and the start and target positions never overlap", () => {
  for (const rule of EXERCISE_RULES) {
    if (rule.motion.kind !== "reps") continue;
    const { start, target, progress } = rule.motion;
    assertHysteresis(rule.id, "start", start);
    assertHysteresis(rule.id, "target", target);
    assert.notEqual(progress.from, progress.to, rule.id);
    let shared = 0;
    for (const s of start.enter) {
      const t = target.enter.find((condition) => condition.metric === s.metric);
      if (!t) continue;
      shared += 1;
      assert.notEqual(s.op, t.op, `${rule.id}: start and target enter ${s.metric} the same way`);
      assert.ok(s.op === "<=" ? t.value > s.value : t.value < s.value, `${rule.id}: ${s.metric} start and target regions overlap`);
      for (const exit of [...start.exit, ...target.exit].filter((condition) => condition.metric === s.metric)) {
        const low = Math.min(s.value, t.value);
        const high = Math.max(s.value, t.value);
        assert.ok(exit.value > low && exit.value < high, `${rule.id}: exit ${exit.metric} ${exit.value} lies between start and target`);
      }
    }
    assert.ok(shared > 0, `${rule.id}: start and target share a measurement`);
  }
});

test("rule copy is complete enough to show before a set", () => {
  for (const rule of EXERCISE_RULES) {
    assert.ok(rule.setupTips.length >= 2, rule.id);
    assert.ok(rule.checks.length > 20 && rule.limits.length > 20, rule.id);
    assert.ok(rule.required.length >= 3, rule.id);
    for (const cue of rule.cues) assert.ok(cue.speech.split(" ").length <= 4, `${rule.id}/${cue.id}: spoken cue is short`);
  }
});

test("workout exercises map to camera rules by library id or by name", () => {
  assert.equal(cameraRuleFor({ id: "push_up", name: "Push-Up" })?.id, "push_up");
  assert.equal(cameraRuleFor({ id: "free-exercise-db-Pushups", name: "Pushups" })?.id, "push_up");
  assert.equal(cameraRuleFor({ id: null, name: "Push-ups" })?.id, "push_up");
  assert.equal(cameraRuleFor({ name: "push ups" })?.id, "push_up");
  assert.equal(cameraRuleFor({ name: "Air Squats" })?.id, "bodyweight_squat");
  assert.equal(cameraRuleFor({ id: "free-exercise-db-Bodyweight_Squat" })?.id, "bodyweight_squat");
  assert.equal(cameraRuleFor({ name: "Reverse lunge" })?.id, "reverse_lunge");
  assert.equal(cameraRuleFor({ name: "Static lunge" })?.id, "split_squat");
  assert.equal(cameraRuleFor({ name: "Mountain Climbers" })?.id, "mountain_climber");
  assert.equal(cameraRuleFor({ id: "free-exercise-db-Mountain_Climbers" })?.id, "mountain_climber");
  assert.equal(cameraRuleFor({ name: "High knees" })?.id, "high_knees");
  assert.equal(cameraRuleFor({ name: "Side plank" })?.id, "side_plank");
  assert.equal(cameraRuleFor({ name: "Wall sit" })?.id, "wall_sit");
  assert.equal(cameraRuleFor({ name: "Superman" })?.id, "superman");
  assert.equal(cameraRuleFor({ id: "dumbbell_shoulder_press", name: "Dumbbell Shoulder Press" })?.id, "shoulder_press");
  assert.equal(cameraRuleFor({ id: "biceps_curl", name: "Biceps Curl" })?.id, "biceps_curl");
  assert.equal(cameraRuleFor({ name: "Dumbbell Bicep Curl" })?.id, "biceps_curl");
  assert.equal(cameraRuleFor({ id: "free-exercise-db-Butt_Lift_Bridge", name: "Butt Lift (Bridge)" })?.id, "glute_bridge");
  assert.equal(cameraRuleFor({ id: "plank", name: "Front Plank" })?.id, "plank");
  assert.equal(cameraRuleFor({ name: "Star jumps" })?.id, "jumping_jack");
});

test("exercises the camera can't judge well get no camera rule", () => {
  for (const exercise of [
    { id: "bench_press", name: "Barbell Bench Press" },
    { id: "walking_lunge", name: "Walking Lunge" },
    { id: "free-exercise-db-Incline_Push-Up", name: "Incline Push-Up" },
    { id: "free-exercise-db-Single_Leg_Glute_Bridge", name: "Single Leg Glute Bridge" },
    { id: "goblet_squat", name: "Goblet Squat" },
    { id: null, name: "Barbell Back Squat" },
    { id: null, name: "" },
  ]) {
    assert.equal(cameraRuleFor(exercise), null, exercise.name);
  }
});

test("the camera is offered only where its result fits the set: reps for rep sets, seconds for timed sets", () => {
  // The library's Mountain Climbers is prescribed as 30 s: a rep count can't be logged against it.
  const climber = cameraRuleFor({ id: "free-exercise-db-Mountain_Climbers", name: "Mountain Climbers" });
  assert.ok(climber);
  assert.equal(cameraFitsSet(climber, true), false, "no rep counting on a timed set");
  assert.equal(cameraFitsSet(climber, false), true, "rep counting on a rep set");
  const plank = getExerciseRule("plank");
  assert.ok(plank);
  assert.equal(cameraFitsSet(plank, true), true, "a hold fills a timed set");
  assert.equal(cameraFitsSet(plank, false), false, "a hold's seconds have nowhere to go on a rep set");
  for (const rule of EXERCISE_RULES) assert.notEqual(cameraFitsSet(rule, true), cameraFitsSet(rule, false), rule.id);
});

test("names are normalised the same way however they are written", () => {
  assert.equal(normaliseExerciseName("Push-Up"), "pushup");
  assert.equal(normaliseExerciseName("PUSH UPS"), "pushups");
  assert.equal(normaliseExerciseName("  Glute   Bridge "), "glute bridge");
  assert.equal(normaliseExerciseName("Butt Lift (Bridge)"), "butt lift bridge");
  assert.equal(getExerciseRule("nope"), null);
});

/** exercise_library ids seeded by the migrations, including the Free Exercise DB import. */
function libraryIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const match of sql.matchAll(/^\('([a-z0-9_]+)',/gm)) ids.add(match[1]);
    for (const match of sql.matchAll(/decode\('([A-Za-z0-9+/=]+)'/g)) {
      for (const row of JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as Array<{ id: string }>) ids.add(row.id);
    }
  }
  return ids;
}

test("every library id a rule claims exists in the seeded exercise library", () => {
  const ids = libraryIds();
  assert.ok(ids.size > 800, `read ${ids.size} library ids`);
  for (const rule of EXERCISE_RULES) {
    for (const id of rule.libraryIds) assert.ok(ids.has(id), `${rule.id}: ${id} is not in the exercise library`);
  }
});
