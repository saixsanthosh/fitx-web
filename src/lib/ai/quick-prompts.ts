import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { storedGoalProgress, type CoachContext } from "./context";
import { clientMetricForUnit } from "@/lib/domain/goals";
import { FOOD_SOURCE_OPTIONS, optionLabel } from "@/lib/domain/profile-options";
import { describeAllergies } from "./diet-rules";
import { cleanText } from "./validate";

/**
 * Short starting points for the coach page, written from the member's own data: today's food against the
 * targets, the last workout, this week's walks, runs and rides, an active goal, and the setup answers. Each one
 * is shown only when its data is there, and never states an unknown value or counts it as 0. Built only for
 * members who chose "Use my FITX data": a chip fills the message box, so what it says is what would be sent.
 * In the 30 days after FITX's eating-disorder note (careMode) no prompt is about food, calories or body weight,
 * as the coach then makes no meal plans and gives no calorie targets (coach.ts).
 */

export type QuickPromptSource = "food" | "training" | "activity" | "goal" | "setup";

export type QuickPrompt = {
  id: string;
  source: QuickPromptSource;
  /** One short line naming the data the prompt comes from ("Today · 820 of 2,150 kcal"). */
  context: string;
  /** The message it puts in the box. */
  text: string;
  mode: "chat" | "meal_plan" | "workout_plan";
};

export type PromptSignals = {
  /** Foods logged today, or null when the food log could not be read. */
  todayFoods: Array<{ calories: number | null; protein: number | null }> | null;
  lastWorkout: { name: string; startedAt: string } | null;
  /** The last 7 days of activities, or null when they could not be read (or Activity is not set up). */
  activities: Array<{ sport: string; distanceM: number | null }> | null;
  /** currentValue is the goal's progress only where the table keeps it (storedGoalProgress); otherwise null. */
  goals: Array<{ title: string; metric?: string | null; category?: string | null; targetValue: number | null; currentValue: number | null; unit: string | null; dueOn: string | null }>;
};

export const MAX_QUICK_PROMPTS = 4;

type Db = Pick<SupabaseClient, "from">;

const whole = (value: number) => Math.round(value).toLocaleString("en-GB");
const oneDecimal = (value: number) => (Math.round(value * 10) / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 });
const known = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numeric = (value: unknown) => (value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);

const SPORT_PAST: Record<string, string> = {
  walk: "walked", run: "ran", ride: "rode", hike: "hiked", trail_run: "ran", mtb: "rode", ebike: "rode", wheelchair: "pushed", skate: "skated", paddle: "paddled",
};
const SPORT_PLURAL: Record<string, [string, string]> = {
  walk: ["walk", "walks"], run: ["run", "runs"], ride: ["ride", "rides"], hike: ["hike", "hikes"], trail_run: ["trail run", "trail runs"],
  mtb: ["mountain bike ride", "mountain bike rides"], ebike: ["e-bike ride", "e-bike rides"], wheelchair: ["wheelchair push", "wheelchair pushes"],
  skate: ["skate", "skates"], paddle: ["paddle", "paddles"],
};

function dayName(iso: string, today: string, timeZone: string) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(new Date(iso));
}

function shortDate(key: string) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function foodPrompt({ facts, summary }: CoachContext, foods: PromptSignals["todayFoods"]): QuickPrompt | null {
  const target = facts.target;
  if (!foods) return null;
  const meals = (summary.food_preferences as { meals_per_day?: number } | undefined)?.meals_per_day ?? null;
  if (!foods.length) {
    if (!target) return null;
    return {
      id: "food-plan",
      source: "food",
      context: `Today · nothing logged · target ${whole(target.calories)} kcal`,
      text: meals ? `Plan my ${meals} meals for today.` : "Plan my meals for today.",
      mode: "meal_plan",
    };
  }
  const caloriesKnown = foods.every((food) => known(food.calories));
  const proteinKnown = foods.every((food) => known(food.protein));
  const eaten = foods.reduce((sum, food) => sum + (food.calories ?? 0), 0);
  const protein = foods.reduce((sum, food) => sum + (food.protein ?? 0), 0);
  if (!target || !caloriesKnown) {
    // Without a target, or with a food that has no calorie value, there is no honest "left today".
    return {
      id: "food-rest",
      source: "food",
      context: `Today · ${foods.length} ${foods.length === 1 ? "food" : "foods"} logged`,
      text: "What should I eat for the rest of today?",
      mode: "chat",
    };
  }
  const left = target.calories - eaten;
  const proteinLeft = proteinKnown ? Math.round(target.protein - protein) : null;
  if (left <= 150) {
    return {
      id: "food-over",
      source: "food",
      context: `Today · ${whole(eaten)} of ${whole(target.calories)} kcal`,
      text: `I'm at ${whole(eaten)} of ${whole(target.calories)} kcal today. What should I change tomorrow?`,
      mode: "chat",
    };
  }
  return {
    id: "food-left",
    source: "food",
    context: `Today · ${whole(eaten)} of ${whole(target.calories)} kcal`,
    text: proteinLeft !== null && proteinLeft > 5
      ? `I have about ${whole(left)} kcal and ${proteinLeft} g protein left today. What should I eat?`
      : `I have about ${whole(left)} kcal left today. What should I eat?`,
    mode: "chat",
  };
}

function trainingPrompt({ facts, summary }: CoachContext, last: PromptSignals["lastWorkout"]): QuickPrompt | null {
  const today = facts.today;
  const recent = last && Date.parse(`${today}T23:59:59Z`) - Date.parse(last.startedAt) <= 14 * 86_400_000 ? last : null;
  if (recent) {
    const when = dayName(recent.startedAt, today, facts.timeZone);
    return {
      id: "training-next",
      source: "training",
      context: `Last workout · ${when}`,
      text: `Plan my next workout after “${recent.name}”.`,
      mode: "workout_plan",
    };
  }
  const days = (summary.training_setup as { days_per_week?: number } | undefined)?.days_per_week ?? null;
  const place = facts.location === "home" ? "home" : facts.location === "both" ? "home or gym" : "gym";
  return {
    id: "training-start",
    source: "training",
    context: days ? `Training · ${days} days a week, ${place}` : `Training · ${place}`,
    text: place === "home or gym" ? `Plan a ${facts.sessionMinutes}-minute workout for today.` : `Plan a ${facts.sessionMinutes}-minute ${place} workout for today.`,
    mode: "workout_plan",
  };
}

function activityPrompt(activities: PromptSignals["activities"]): QuickPrompt | null {
  if (!activities || !activities.length) return null;
  const distances = activities.map((activity) => activity.distanceM).filter(known);
  const km = distances.length === activities.length ? distances.reduce((sum, metres) => sum + metres, 0) / 1000 : null;
  const sports = [...new Set(activities.map((activity) => activity.sport))];
  const single = sports.length === 1 && SPORT_PAST[sports[0]] ? sports[0] : null;
  const count = activities.length;
  const noun = single ? SPORT_PLURAL[single][count === 1 ? 0 : 1] : count === 1 ? "activity" : "activities";
  const context = `Activity · ${count} ${noun}${km !== null && km > 0 ? `, ${oneDecimal(km)} km` : ""} in 7 days`;
  const text = single && km !== null && km > 0
    ? `I ${SPORT_PAST[single]} ${oneDecimal(km)} km this week. How should I fit it around my training?`
    : `I logged ${count} ${noun} this week. How should I fit ${count === 1 ? "it" : "them"} around my training?`;
  return { id: "activity-week", source: "activity", context, text, mode: "chat" };
}

/** Goals about food or body weight, which care mode leaves out. */
const FOOD_OR_WEIGHT_METRICS = new Set(["calories_kcal", "protein_g", "water_ml", "body_weight_kg"]);
const FOOD_OR_WEIGHT_CATEGORIES = new Set(["nutrition", "body"]);

function goalPrompt(goals: PromptSignals["goals"], careMode: boolean): QuickPrompt | null {
  const goal = goals.find((item) => item.title && !(careMode && (FOOD_OR_WEIGHT_METRICS.has(item.metric ?? "") || FOOD_OR_WEIGHT_CATEGORIES.has(item.category ?? ""))));
  if (!goal) return null;
  const progress = !careMode && known(goal.currentValue) && known(goal.targetValue) ? `${oneDecimal(goal.currentValue)} of ${oneDecimal(goal.targetValue)}${goal.unit ? ` ${goal.unit}` : ""}` : null;
  return {
    id: "goal",
    source: "goal",
    context: progress ? `Goal · ${progress}` : "Goal · active",
    text: `How do I reach my goal “${goal.title}”${goal.dueOn ? ` by ${shortDate(goal.dueOn)}` : ""}?`,
    mode: "chat",
  };
}

/** Food answers from setup: nutrition goal, diet, allergies, foods avoided and where meals come from. */
function foodAnswersPrompt({ facts, summary }: CoachContext): QuickPrompt | null {
  const food = (summary.food_preferences ?? {}) as { diet?: string; dislikes?: string[] };
  const diet = facts.diet.length ? facts.diet.map((rule) => rule.replace(/_/g, "-")).join(", ") : null;
  const allergies = facts.allergies.rules.length || facts.allergies.other.length ? describeAllergies(facts.allergies) : null;
  const avoided = (food.dislikes ?? []).slice(0, 2);
  const highProtein = facts.nutritionGoal === "High protein";
  const source = facts.foodSource === "home" ? "home-cooked" : facts.foodSource === "outside" ? "eating-out" : null;
  if (!diet && !allergies && !avoided.length && !highProtein && !source) return null;
  const words = [highProtein ? "high-protein" : null, diet, source].filter(Boolean).join(" ");
  const without = [allergies ? `no ${allergies.toLowerCase()}` : null, avoided.length ? `no ${avoided.join(" or ").toLowerCase()}` : null].filter(Boolean).join(", ");
  const parts = [facts.nutritionGoal && facts.nutritionGoal !== "No specific preference" ? facts.nutritionGoal : null, diet ? diet[0].toUpperCase() + diet.slice(1) : null, optionLabel(FOOD_SOURCE_OPTIONS, facts.foodSource)].filter(Boolean);
  return {
    id: "food-answers",
    source: "setup",
    context: parts.length ? `Your food · ${parts.slice(0, 2).join(", ")}` : "Your food answers",
    text: `Give me easy ${words ? `${words} ` : ""}snack ideas${without ? `, ${without}` : ""}.`,
    mode: "chat",
  };
}

/** Age (from the birth date), experience and weekly availability. */
function setupPrompt({ facts, summary }: CoachContext): QuickPrompt | null {
  const days = (summary.training_setup as { days_per_week?: number } | undefined)?.days_per_week ?? null;
  if (facts.age === null && !days) return null;
  const level = facts.level.replace(/_/g, " ");
  const who = facts.age !== null ? `I'm ${facts.age} and ${/^[aeiou]/i.test(level) ? "an" : "a"} ${level}` : `I'm ${/^[aeiou]/i.test(level) ? "an" : "a"} ${level}`;
  return {
    id: "setup",
    source: "setup",
    context: [facts.age !== null ? `Age ${facts.age}` : null, days ? `${days} days a week` : null].filter(Boolean).join(" · "),
    text: `${who}${days ? ` with ${days} days a week` : ""}. What should I focus on this month?`,
    mode: "chat",
  };
}

/**
 * Up to four prompts, most timely first: today's food, training, this week's activity, a goal, then setup answers.
 * `careMode`: FITX showed its eating-disorder note in the last 30 days (CARE_DAYS), so the food prompts, the food
 * answers and food or weight goals are left out, and no goal names a number.
 */
export function buildQuickPrompts(context: CoachContext, signals: PromptSignals, options: { plansAllowed: boolean; careMode?: boolean }): QuickPrompt[] {
  if (context.facts.minor) return [];
  const careMode = options.careMode === true;
  const all = [
    careMode ? null : foodPrompt(context, signals.todayFoods),
    trainingPrompt(context, signals.lastWorkout),
    activityPrompt(signals.activities),
    goalPrompt(signals.goals, careMode),
    careMode ? null : foodAnswersPrompt(context),
    setupPrompt(context),
  ].filter((prompt): prompt is QuickPrompt => prompt !== null);
  // Plans need "Use my FITX data" and an adult profile; otherwise a plan prompt would only be refused. Care mode
  // refuses meal plans (planBlock in coach.ts).
  return all
    .filter((prompt) => (options.plansAllowed || prompt.mode === "chat") && !(careMode && prompt.mode === "meal_plan"))
    .slice(0, MAX_QUICK_PROMPTS);
}

/**
 * Reads what the prompts need, under the member's own session. Each read that fails (a table not there yet)
 * leaves its prompt out; nothing is guessed.
 */
export async function loadPromptSignals(db: Db, userId: string, context: CoachContext, now = new Date()): Promise<PromptSignals> {
  const today = context.facts.today;
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const rows = async (query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Record<string, unknown>[] | null> => {
    try {
      const { data, error } = await query;
      return !error && Array.isArray(data) ? (data as Record<string, unknown>[]) : null;
    } catch {
      return null;
    }
  };
  const goalQuery = (columns: string) => db.from("goals").select(columns).eq("user_id", userId).eq("status", "active").order("due_on", { ascending: true, nullsFirst: false }).limit(3);
  const [foods, workouts, activities, goals] = await Promise.all([
    rows(db.from("meals").select("calories, protein").eq("user_id", userId).eq("date", today).limit(200)),
    rows(db.from("workout_sessions").select("name, started_at").eq("user_id", userId).eq("status", "completed").order("started_at", { ascending: false }).limit(1)),
    rows(db.from("activities").select("sport, distance_m").eq("user_id", userId).gte("started_at", weekAgo).limit(100)),
    // Without goals v2 (no metric or period) the goal is still offered, with no number (storedGoalProgress).
    rows(goalQuery("title, category, metric, period, target_value, current_value, unit, due_on")).then((found) => found ?? rows(goalQuery("title, category, target_value, current_value, unit, due_on"))),
  ]);
  const last = workouts?.[0];
  const lastName = cleanText(last?.name, 48);
  return {
    todayFoods: foods ? foods.map((row) => ({ calories: numeric(row.calories), protein: numeric(row.protein) })) : null,
    lastWorkout: lastName && typeof last?.started_at === "string" ? { name: lastName, startedAt: last.started_at } : null,
    activities: activities ? activities.map((row) => ({ sport: typeof row.sport === "string" ? row.sport : "", distanceM: numeric(row.distance_m) })) : null,
    goals: (goals ?? []).flatMap((row) => {
      const title = cleanText(row.title, 60);
      const metric = typeof row.metric === "string" ? row.metric : null;
      const category = typeof row.category === "string" ? row.category : null;
      // A distance or active-minutes goal is stored with a reserved unit ("km (activities)"): not a unit to show.
      const unit = clientMetricForUnit(row.unit) === null ? cleanText(row.unit, 12) : null;
      return title ? [{ title, metric, category, targetValue: numeric(row.target_value), currentValue: storedGoalProgress(row as Parameters<typeof storedGoalProgress>[0]), unit, dueOn: typeof row.due_on === "string" ? row.due_on.slice(0, 10) : null }] : [];
    }),
  };
}
