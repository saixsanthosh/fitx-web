// Integration (workouts' bug 51 and home's bug 26): "Build from your split" said "From your training split in Profile:
// Full Body · 3 days" for every member, because workout_split always holds a value (the column defaults to full_body),
// while Profile shows that same split as "Not set" before the Workouts setup and as "45 min · Full body, until you
// change it" while session length and split hold their defaults (review home-5). The builder now names the split as
// the member's own only when Profile does; its days still come from that split.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROGRAMMES } from "@/data/programmes";
import { sessionAnswer } from "@/app/(dashboard)/profile/profile-answers";
import { builderSplit, profileSplitAnswer } from "@/app/(dashboard)/workouts/_lib/split-source";
import { sessionDefaultsKept } from "@/lib/domain/profile-options";
import { normalizePreferences } from "@/lib/domain/user-context";
import { splitProgrammeId } from "@/lib/training/programmes";
import { isWorkoutSetupDone } from "@/lib/training/setup";

// user_preferences straight after the first setup (as tests/profile/day-one-answers.test.ts has it).
const DAY_ONE = { workout_location: "gym", fitness_level: "beginner", primary_goal: "weight_loss", workouts_per_week: 3, session_duration_minutes: 45, workout_split: "full_body", workout_setup_at: null as string | null };
const SETUP_AT = "2026-11-25T19:30:00Z";

/** Profile's reading of the row (through the shared context) and the builder's line for it, at the gym. */
function bothScreens(row: typeof DAY_ONE) {
  const { values } = normalizePreferences(row);
  const equipmentLists = { available: true, home: { keys: [] as string[], saved: false }, gym: { keys: ["barbell", "dumbbell"], saved: false } };
  const profile = sessionAnswer({ preferences: values, workoutSetupAt: row.workout_setup_at, equipmentLists });
  // The Workouts page: its own setup state (the same rule) and the row as read.
  const setupDone = isWorkoutSetupDone({ setupAt: row.workout_setup_at, hasEquipmentList: false });
  const builder = builderSplit({
    target: "gym", followed: null, programmes: PROGRAMMES,
    split: profileSplitAnswer(setupDone, row), splitId: splitProgrammeId(row.workout_split, "gym", true),
  });
  return { profile, builder };
}

describe("the builder calls the split the member's only when Profile does", () => {
  test("before the Workouts setup: Profile says Not set, the builder doesn't name Profile", () => {
    const { profile, builder } = bothScreens(DAY_ONE);
    assert.deepEqual(profile, { kind: "not_set" });
    assert.equal(builder?.source, "default");
    assert.doesNotMatch(builder?.label ?? "", /Profile|your training split/);
    assert.equal(builder?.programme.id, "full-body-3", "the days still come from the stored split");
  });

  test("after the setup, with both defaults: Profile shows FITX's assumption, the builder doesn't call it yours", () => {
    const { profile, builder } = bothScreens({ ...DAY_ONE, workout_setup_at: SETUP_AT });
    assert.equal(profile.kind, "assumed");
    assert.equal(builder?.source, "default");
    assert.doesNotMatch(builder?.label ?? "", /Profile|your training split/);
    assert.equal(builder?.programme.id, "full-body-3");
  });

  test("a split or session length the member changed: both screens treat it as theirs", () => {
    const ppl = bothScreens({ ...DAY_ONE, workout_setup_at: SETUP_AT, workout_split: "push_pull_legs" });
    assert.equal(ppl.profile.kind, "answer");
    assert.equal(ppl.builder?.source, "profile");
    assert.match(ppl.builder?.label ?? "", /^From your training split in Profile: /);
    assert.equal(ppl.builder?.programme.id, "ppl-3");
    const longer = bothScreens({ ...DAY_ONE, workout_setup_at: SETUP_AT, session_duration_minutes: 60 });
    assert.deepEqual(longer.profile, { kind: "answer", text: "60 min · Full body" });
    assert.match(longer.builder?.label ?? "", /^From your training split in Profile: /);
  });

  test("one rule decides it for both (profile-options.ts sessionDefaultsKept)", () => {
    assert.equal(sessionDefaultsKept({ session_duration_minutes: 45, workout_split: "full_body" }), true);
    assert.equal(sessionDefaultsKept({ session_duration_minutes: 45, workout_split: "upper_lower" }), false);
    assert.equal(sessionDefaultsKept({ session_duration_minutes: 30, workout_split: "full_body" }), false);
    assert.equal(sessionDefaultsKept({}), false, "no row read: not the defaults (the builder then has no split to name)");
    assert.equal(profileSplitAnswer(true, {}), null);
    assert.equal(profileSplitAnswer(false, { session_duration_minutes: 60, workout_split: "upper_lower" }), null, "before the setup");
    assert.equal(profileSplitAnswer(true, { session_duration_minutes: 60, workout_split: "upper_lower" }), "upper_lower");
    const answers = readFileSync("src/app/(dashboard)/profile/profile-answers.ts", "utf8");
    assert.match(answers, /return sessionDefaultsKept\(data\.preferences\) \? \{ kind: "assumed", text \} : \{ kind: "answer", text \};/);
  });
});

test("the Workouts page passes the split only through that rule, and still plans from the stored split", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
  const auto = page.slice(page.indexOf("function autoSplit("), page.indexOf("function autoProgramme("));
  assert.match(auto, /split: profileSplitAnswer\(Boolean\(setup\?\.done\), preferences\), splitId, programmes,/);
  assert.match(auto, /splitProgrammeId\(preferences\.workout_split, target, ownedFor\(target\)\.has\("dumbbell"\)\)/);
});
