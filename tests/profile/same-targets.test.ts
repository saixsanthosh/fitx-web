import "../ai/support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// One member, as each screen reads them, must get one set of daily targets: Home (fitx_today_summary plus the
// nutrition goal read on its own), Nutrition (its own profile and preferences queries), onboarding (the form),
// Profile and the provider (targetsFor) and the AI coach (buildCoachContext). The .tsx screens cannot be loaded
// here, so their calls are checked in their source and repeated with the same arguments.

const { calculateNutritionTargets, estimateNutritionTargets } = await import("@/lib/domain/nutrition");
const { profileAge } = await import("@/lib/domain/profile-options");
const { normalizePreferences, normalizeProfile, targetsFor } = await import("@/lib/domain/user-context");
const { estimatedTargets, parseTodaySummary } = await import("@/lib/domain/today");
const { withBirthDateAge, withNutritionFocus } = await import("@/lib/data/today");
const { buildCoachContext } = await import("@/lib/ai/context");

const ROOT = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, ROOT), "utf8");

const LOCAL_DATE = "2026-11-20";
const NOW = new Date(`${LOCAL_DATE}T06:30:00Z`); // midday in India
const WEIGHT = 82;

type Member = { gender: string; height: number; birthDate: string; storedAge: number; goal: string; activity: string; focus: string | null };

const MEMBERS: Member[] = [
  { gender: "male", height: 178, birthDate: "1996-11-20", storedAge: 29, goal: "muscle_gain", activity: "moderate", focus: "high_protein" },
  { gender: "female", height: 162, birthDate: "1990-02-11", storedAge: 36, goal: "weight_loss", activity: "light", focus: "high_protein" },
  { gender: "male", height: 170, birthDate: "1985-06-01", storedAge: 41, goal: "general_fitness", activity: "active", focus: "balanced" },
  { gender: "female", height: 158, birthDate: "2001-09-30", storedAge: 25, goal: "maintain_weight", activity: "sedentary", focus: null },
];

function everyScreen(member: Member) {
  const profileRow = { name: "Test member", age: member.storedAge, date_of_birth: member.birthDate, gender: member.gender, height: member.height, weight: WEIGHT, target_weight: null };
  const prefsRow: Record<string, unknown> = {
    timezone: "Asia/Kolkata", primary_goal: member.goal, activity_level: member.activity, nutrition_focus: member.focus,
    workouts_per_week: 4, daily_water_goal_ml: 2500,
  };

  // Profile and the shared provider.
  const profile = targetsFor(normalizeProfile(profileRow, new Date(`${LOCAL_DATE}T12:00:00`)), normalizePreferences(prefsRow).values, WEIGHT);

  // Home: the summary has no birth date or nutrition goal; loadTodaySummary adds both.
  const rpc = parseTodaySummary({
    local_date: LOCAL_DATE, timezone: "Asia/Kolkata", week_start: "2026-11-16",
    nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0, entries: 0 }, water: { ml: 0, entries: 0 },
    workouts: { today: 0, week: 0, week_days: [] }, weight: { kg: WEIGHT, date: LOCAL_DATE }, previous_weight: null,
    profile: { name: "Test member", age: member.storedAge, gender: member.gender, height: member.height, weight: WEIGHT, target_weight: null },
    preferences: { workouts_per_week: 4, daily_water_goal_ml: 2500, activity_level: member.activity, primary_goal: member.goal },
    planned_workouts: [], todo: null,
  });
  assert.ok(rpc, "the summary parses");
  const home = estimatedTargets(withNutritionFocus(withBirthDateAge(rpc, member.birthDate, LOCAL_DATE), member.focus));

  // Nutrition, as its page calls it.
  const nutrition = estimateNutritionTargets(
    { age: profileAge({ age: member.storedAge, date_of_birth: member.birthDate }, LOCAL_DATE), gender: member.gender, height: member.height, weight: WEIGHT },
    member.activity, member.goal, member.focus,
  );

  // Onboarding, as its form calls it (v3 database).
  const onboarding = calculateNutritionTargets(
    { age: profileAge({ date_of_birth: member.birthDate }, LOCAL_DATE), gender: member.gender, height: member.height, weight: WEIGHT },
    member.activity, member.goal, member.focus,
  );

  // The AI coach.
  const coach = buildCoachContext({
    profile: profileRow, preferences: prefsRow, weighIns: [{ date: LOCAL_DATE, weight: WEIGHT }], meals: [], customFoods: [], sessions: [],
    recentMuscles: [], records: [], goals: [], planner: [],
  } as never, NOW).facts.target;

  return { profile, home, nutrition, onboarding, coach };
}

const macros = (targets: { calories: number; protein: number; carbs: number; fat: number } | null) =>
  targets ? { calories: targets.calories, protein: targets.protein, carbs: targets.carbs, fat: targets.fat } : null;

describe("the same member gets the same daily targets on every screen", () => {
  for (const member of MEMBERS) {
    test(`${member.goal}, ${member.focus ?? "no nutrition goal"}`, () => {
      const screens = everyScreen(member);
      const expected = macros(screens.profile);
      assert.ok(expected, "the member has targets");
      for (const [screen, targets] of Object.entries(screens)) assert.deepEqual(macros(targets), expected, screen);
    });
  }

  test("High protein raises protein on every screen, not on one only", () => {
    const high = everyScreen(MEMBERS[0]);
    const standard = everyScreen({ ...MEMBERS[0], focus: null });
    for (const screen of Object.keys(high) as Array<keyof typeof high>) {
      assert.ok(high[screen]!.protein > standard[screen]!.protein, `${screen}: High protein raises protein`);
      assert.equal(high[screen]!.calories, standard[screen]!.calories, `${screen}: calories stay the same`);
    }
  });

  test("a birthday counts on every screen before the profile is saved again", () => {
    // MEMBERS[0] turns 30 on LOCAL_DATE; the stored age still says 29.
    const screens = everyScreen(MEMBERS[0]);
    const at29 = calculateNutritionTargets({ age: 29, gender: "male", height: 178, weight: WEIGHT }, "moderate", "muscle_gain", "high_protein");
    assert.notDeepEqual(macros(screens.home), macros(at29), "the age is 30 today");
  });

  test("the screens that cannot be loaded here make those same calls", () => {
    assert.match(read("src/app/(dashboard)/nutrition/page.tsx"), /estimateNutritionTargets\(\{ \.\.\.profile, age: profileAge\(\{ age: profile\.age, date_of_birth: birthDate \}\) \}, prefs\?\.activity_level, prefs\?\.primary_goal, prefs\?\.nutrition_focus \?\? null\)/);
    assert.match(read("src/app/(dashboard)/nutrition/page.tsx"), /select\(`\$\{PREF_COLUMNS\},nutrition_focus`\)/, "Nutrition reads the nutrition goal");
    assert.match(read("src/app/(auth)/onboarding/OnboardingFlow.tsx"), /calculateNutritionTargets\(\{ age, gender: form\.gender, height: form\.heightCm, weight: form\.weightKg \}, form\.activity, form\.goal, focus\)/);
    assert.match(read("src/app/(dashboard)/profile/ProfileView.tsx"), /return targetsFor\(data\.profile, data\.preferences, data\.currentWeightKg\);/);
    assert.match(read("src/lib/data/today.ts"), /loadNutritionFocus\(db, userId\)/, "Home reads the nutrition goal");
  });
});
