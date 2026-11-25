// Bug 71 (coach-help-5): the consent screen said "training setup (both, dumbbell, bands, bench; …)", the stored values,
// on the very screen where the member decides what to share. It now uses Profile's labels, and names only what the
// summary really sends: no default place or equipment before the Workouts setup is done.
import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const { buildCoachContext } = await import("@/lib/ai/context");
const { sharedSummaryLines, trainingSetupWords } = await import("@/lib/ai/status");
const { LOCATION_OPTIONS, optionLabel } = await import("@/lib/domain/profile-options");

const NOW = new Date("2026-11-17T06:30:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";

function sources(preferences: Record<string, unknown>) {
  return {
    profile: { age: 29, gender: "female", height: 162, weight: 60, experience: "Beginner", id: USER_ID },
    preferences: { user_id: USER_ID, timezone: "Asia/Kolkata", primary_goal: "fat_loss", activity_level: "moderate", session_duration_minutes: 45, workout_split: "full_body", ...preferences },
    weighIns: [], meals: [], customFoods: [], sessions: [], recentMuscles: [], records: [], goals: [], planner: [], activities: null,
  };
}
const setupLine = (lines: string[]) => lines.find((line) => line.startsWith("Goal ("))!;

describe("the consent screen names the training setup as Profile does", () => {
  test("gym and home, with the equipment's own names", () => {
    const context = buildCoachContext(sources({ workout_location: "both", equipment: ["dumbbell", "bands", "bench"], fitness_level: "beginner", workouts_per_week: 3, workout_setup_at: "2026-11-02T08:00:00Z" }) as never, NOW);
    const line = setupLine(sharedSummaryLines(context));
    assert.equal(line, "Goal (Fat loss), activity level, experience and training setup (Gym and home, Dumbbells, Resistance bands, Weight bench; level, days a week, session length and split)");
    assert.equal(optionLabel(LOCATION_OPTIONS, "both"), "Gym and home", "the label Profile shows for “both”");
    assert.doesNotMatch(line, /\bboth\b|, bands\b|\(fat loss\)/);
  });

  test("no equipment, typed words and long lists read naturally", () => {
    assert.equal(trainingSetupWords({ location: "home", equipment: ["bodyweight"] }), "Home, No equipment; level, days a week, session length and split");
    assert.equal(trainingSetupWords({ location: "outdoor", equipment: ["kettlebell", "trx strap"] }), "Outdoors, Kettlebell, trx strap; level, days a week, session length and split");
    assert.equal(
      trainingSetupWords({ location: "gym", equipment: ["dumbbell", "barbell", "bench", "cable", "rack"] }),
      "Gym, Dumbbells, Barbell and plates, Weight bench, Cable machine…; level, days a week, session length and split",
    );
    assert.equal(trainingSetupWords({ location: "gym", equipment: ["dumbbell", "dumbbells"] }), "Gym, Dumbbells; level, days a week, session length and split", "one name once");
  });

  test("injuries and limitations picked from Profile's list keep Profile's words; the member's own notes stay as typed", async () => {
    const { limitationWords } = await import("@/lib/ai/status");
    assert.equal(limitationWords("lower back, knee, wrist"), "Lower back, Knees, Wrists or elbows");
    assert.equal(limitationWords("knee, Old ACL surgery, left side"), "Knees, Old ACL surgery, left side");
    const context = buildCoachContext(sources({ limitations: ["shoulder", "Tennis elbow"] }) as never, NOW);
    assert.ok(sharedSummaryLines(context).includes("Injuries or limitations: Shoulders, Tennis elbow"));
  });

  test("before the Workouts setup is done, no default place or equipment is shown as the member's answer", () => {
    const context = buildCoachContext(sources({ workout_location: "gym", equipment: [] }) as never, NOW);
    assert.equal((context.summary.training_setup as Record<string, unknown>).location, undefined, "the summary leaves them out");
    const line = setupLine(sharedSummaryLines(context));
    assert.equal(line, "Goal (Fat loss), activity level, experience and training setup (session length and split)");
    assert.doesNotMatch(line, /Gym|No equipment|bodyweight/);
  });
});
