import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const { buildCoachContext } = await import("@/lib/ai/context");
const { buildQuickPrompts, MAX_QUICK_PROMPTS } = await import("@/lib/ai/quick-prompts");

const NOW = new Date("2026-11-16T09:00:00Z");
const context = (preferences: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) =>
  buildCoachContext({
    profile: { age: 34, gender: "female", height: 165, weight: 62, ...profile },
    preferences: { timezone: "Asia/Kolkata", primary_goal: "general_fitness", activity_level: "moderate", workout_location: "home", fitness_level: "intermediate", workouts_per_week: 4, session_duration_minutes: 30, meals_per_day: 4, ...preferences },
    weighIns: [], meals: [], customFoods: [], sessions: [], recentMuscles: [], records: [], goals: [], planner: [],
  } as never, NOW);
const none = { todayFoods: [], lastWorkout: null, activities: [], goals: [] };

describe("quick prompts", () => {
  test("nothing logged today suggests planning the member's own number of meals", () => {
    const [food] = buildQuickPrompts(context(), none, { plansAllowed: true });
    assert.equal(food.mode, "meal_plan");
    assert.equal(food.text, "Plan my 4 meals for today.");
    assert.match(food.context, /^Today · nothing logged · target [\d,]+ kcal$/);
  });

  test("near or over the target it asks about tomorrow instead of food left", () => {
    const target = context().facts.target!;
    const [food] = buildQuickPrompts(context(), { ...none, todayFoods: [{ calories: target.calories, protein: 80 }] }, { plansAllowed: true });
    assert.match(food.text, /^I'm at [\d,]+ of [\d,]+ kcal today\. What should I change tomorrow\?$/);
  });

  test("without a recent workout it plans one from the setup answers", () => {
    const prompts = buildQuickPrompts(context(), none, { plansAllowed: true });
    const training = prompts.find((prompt) => prompt.source === "training")!;
    assert.equal(training.text, "Plan a 30-minute home workout for today.");
    assert.equal(training.context, "Training · 4 days a week, home");
  });

  test("a goal with an unknown current value names no number", () => {
    const prompts = buildQuickPrompts(context(), { ...none, goals: [{ title: "Run 10 km", targetValue: 10, currentValue: null, unit: "km", dueOn: "2027-01-31" }] }, { plansAllowed: true });
    const goal = prompts.find((prompt) => prompt.source === "goal")!;
    assert.equal(goal.context, "Goal · active");
    assert.equal(goal.text, "How do I reach my goal “Run 10 km” by 31 Jan?");
  });

  test("setup answers: age from the birth date, diet, allergies, foods avoided and the nutrition goal", () => {
    const ctx = context({ diet_type: "vegetarian", allergies: ["peanuts"], food_dislikes: ["Mushroom"], nutrition_focus: "high_protein", food_source: "home" }, { date_of_birth: "1990-05-02", age: 20 });
    assert.equal(ctx.facts.age, 36);
    const prompts = buildQuickPrompts(ctx, { ...none, todayFoods: null }, { plansAllowed: true });
    const food = prompts.find((prompt) => prompt.id === "food-answers")!;
    assert.equal(food.text, "Give me easy high-protein vegetarian home-cooked snack ideas, no peanuts, no mushroom.");
    assert.equal(food.context, "Your food · High protein, Vegetarian");
  });

  test("at most four, no plan prompts when plans are off, and none for under-18s", () => {
    const busy = { todayFoods: [{ calories: 300, protein: 10 }], lastWorkout: { name: "Legs", startedAt: "2026-11-15T12:00:00Z" }, activities: [{ sport: "walk", distanceM: 3000 }], goals: [{ title: "Squat 60 kg", targetValue: 60, currentValue: 40, unit: "kg", dueOn: null }] };
    assert.equal(buildQuickPrompts(context(), busy, { plansAllowed: true }).length, MAX_QUICK_PROMPTS);
    assert.ok(buildQuickPrompts(context(), busy, { plansAllowed: false }).every((prompt) => prompt.mode === "chat"));
    assert.deepEqual(buildQuickPrompts(context({}, { age: 16 }), busy, { plansAllowed: true }), []);
  });
});
