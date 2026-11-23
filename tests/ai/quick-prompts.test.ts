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
    weighIns: [], meals: [], customFoods: [], sessions: [], recentMuscles: [], records: [], goals: [], planner: [], equipmentListSaved: true,
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

  test("before the Workouts setup no prompt states the default place, level or days", () => {
    const fresh = buildCoachContext({
      profile: { age: 29, gender: "female", height: 165, weight: 62 },
      preferences: { timezone: "Asia/Kolkata", primary_goal: "general_fitness", workout_location: "gym", fitness_level: "beginner", workouts_per_week: 3, session_duration_minutes: 45 },
      weighIns: [], meals: [], customFoods: [], sessions: [], recentMuscles: [], records: [], goals: [], planner: [], equipmentListSaved: false,
    } as never, NOW);
    const prompts = buildQuickPrompts(fresh, { ...none, todayFoods: null }, { plansAllowed: true });
    assert.equal(prompts.find((prompt) => prompt.id === "training-start"), undefined);
    const setup = prompts.find((prompt) => prompt.id === "setup")!;
    assert.equal(setup.text, "I'm 29. What should I focus on this month?");
    assert.equal(setup.context, "Age 29");
    assert.doesNotMatch(JSON.stringify(prompts), /beginner|gym|3 days/);
    const done = buildQuickPrompts(context({}, { age: 29 }), { ...none, todayFoods: null }, { plansAllowed: true });
    assert.equal(done.find((prompt) => prompt.id === "setup")!.text, "I'm 29 and an intermediate with 4 days a week. What should I focus on this month?");
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

  test("care mode: no food, calorie or weight prompt, no meal plan and no goal number", () => {
    const ctx = context({ diet_type: "vegetarian", nutrition_focus: "high_protein" });
    const signals = {
      todayFoods: [],
      lastWorkout: null,
      activities: [{ sport: "walk", distanceM: 3000 }],
      goals: [
        { title: "Reach 55 kg", metric: "body_weight_kg", category: "body", targetValue: 55, currentValue: null, unit: "kg", dueOn: null },
        { title: "Read 10 books", metric: "manual", category: "personal", targetValue: 10, currentValue: 3, unit: "books", dueOn: null },
      ],
    };
    assert.equal(buildQuickPrompts(ctx, signals, { plansAllowed: true })[0].mode, "meal_plan", "outside care mode the meal plan leads");
    const care = buildQuickPrompts(ctx, signals, { plansAllowed: true, careMode: true });
    assert.deepEqual(care.map((prompt) => prompt.id), ["training-start", "activity-week", "goal", "setup"]);
    assert.equal(care.find((prompt) => prompt.id === "goal")!.context, "Goal · active");
    assert.match(care.find((prompt) => prompt.id === "goal")!.text, /Read 10 books/);
    assert.doesNotMatch(JSON.stringify(care), /kcal|protein|snack|55 kg|\d+ of \d+/i);
  });

  test("at most four, no plan prompts when plans are off, and none for under-18s", () => {
    const busy = { todayFoods: [{ calories: 300, protein: 10 }], lastWorkout: { name: "Legs", startedAt: "2026-11-15T12:00:00Z" }, activities: [{ sport: "walk", distanceM: 3000 }], goals: [{ title: "Squat 60 kg", targetValue: 60, currentValue: 40, unit: "kg", dueOn: null }] };
    assert.equal(buildQuickPrompts(context(), busy, { plansAllowed: true }).length, MAX_QUICK_PROMPTS);
    assert.ok(buildQuickPrompts(context(), busy, { plansAllowed: false }).every((prompt) => prompt.mode === "chat"));
    assert.deepEqual(buildQuickPrompts(context({}, { age: 16 }), busy, { plansAllowed: true }), []);
  });

  test("the newer Activity sports read naturally in the week's prompt", () => {
    const prompts = buildQuickPrompts(context(), { ...none, activities: [{ sport: "hike", distanceM: 6200 }, { sport: "hike", distanceM: 4000 }] }, { plansAllowed: true });
    const activity = prompts.find((prompt) => prompt.id === "activity-week");
    assert.equal(activity?.context, "Activity · 2 hikes, 10.2 km in 7 days");
    assert.equal(activity?.text, "I hiked 10.2 km this week. How should I fit it around my training?");
  });
});
