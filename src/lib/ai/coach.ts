import "server-only";
import type { AiConfig } from "./config";
import { buildCoachContext, loadContextSources, type CoachContext, type MemberFacts } from "./context";
import { foodConflict } from "./diet-rules";
import type { CatalogueFood } from "./food-catalogue";
import type { LiveLookups } from "./food-lookup";
import { customFoodFor, customMealFor, groundFood, resize, sumItems, type GroundedFood } from "./grounding";
import { MEAL_PLAN_SCHEMA, SWAP_SCHEMA, WORKOUT_SCHEMA, parseMealPlan, parseSwap, parseWorkout, type ModelMealPlan } from "./plans";
import { chatSystemPrompt, historyTurns, mealPlanSystemPrompt, memberTurn, swapSystemPrompt, workoutSystemPrompt, type ExerciseCandidate } from "./prompts";
import { PROVIDER_LABELS } from "./registry";
import { AiUnavailableError, type AiRouter } from "./router";
import { cautionNotes, screenMessage, type SafetyCaution } from "./safety";
import * as store from "./store";
import type {
  AiTask,
  CoachActionView,
  CoachErrorCode,
  CoachFoodItem,
  CoachMeal,
  CoachMealPlan,
  CoachMessageView,
  CoachQuota,
  CoachStreamEvent,
  CoachSwap,
  CoachWorkoutPlan,
} from "./types";
import { cleanMultiline, cleanText, round1 } from "./validate";

/**
 * One coach turn, from the member's message to a saved, checked reply. The route handlers do the
 * HTTP part (session, same-origin, body limits); this module does the coaching part and never
 * returns a reply that did not come from a model or from FITX's own fixed safety notes.
 */

export class CoachError extends Error {
  readonly code: CoachErrorCode;
  readonly retryAt?: string;
  constructor(code: CoachErrorCode, message: string, retryAt?: string) {
    super(message);
    this.name = "CoachError";
    this.code = code;
    this.retryAt = retryAt;
  }
}

export type CoachDeps = {
  db: store.Db;
  userId: string;
  config: AiConfig;
  router: AiRouter;
  catalogue: () => readonly CatalogueFood[];
  live: LiveLookups;
  signal?: AbortSignal;
  now?: () => Date;
};

export type TurnInput = { threadId: string | null; message: string; mode: "chat" | "meal_plan" | "workout_plan"; budgetNote: string | null };
type Emit = (event: CoachStreamEvent) => void;

export const MESSAGE_MAX = 2000;

/** Messages that clearly ask for a whole plan go to the checked plan tasks instead of free chat. */
export function detectTask(text: string): "chat" | "meal_plan" | "workout_plan" {
  const asks = /\b(make|create|give|build|suggest|need|want|write|design|prepare|generate|draft|recommend|can you|could you)\b/i.test(text);
  if (/\bwhat should i eat (today|tomorrow)\b/i.test(text) || /^\s*plan (my|a|the|today'?s|tomorrow'?s)?\s*(meals?|food|diet|day of eating)\b/i.test(text)) return "meal_plan";
  if (asks && /\b(meal|food|diet|eating|nutrition)\s+plan\b/i.test(text)) return "meal_plan";
  if (/^\s*plan (my|a|the|today'?s)?\s*workout\b/i.test(text)) return "workout_plan";
  if (asks && /\b(workout|training|exercise|gym)\s+(plan|routine|session|program|programme)\b/i.test(text)) return "workout_plan";
  return "chat";
}

export async function runCoachTurn(deps: CoachDeps, input: TurnInput, emit: Emit): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const consent = await store.getConsent(deps.db, deps.userId);
  if (!consent) throw new CoachError("consent_required", "Agree to how the coach uses your data first.");

  const safety = screenMessage(input.message);
  const basics = await loadContextSources(deps.db, deps.userId, now, { full: false });
  const basicFacts = buildCoachContext(basics, now).facts;
  const plansAllowed = consent.shareData && !basicFacts.minor;

  let task: TurnInput["mode"] = input.mode;
  if (task === "chat" && plansAllowed && safety.kind === "ok") task = detectTask(input.message);
  if (task !== "chat" && !plansAllowed) {
    throw new CoachError(
      "plans_unavailable",
      basicFacts.minor
        ? "Meal and workout plans aren't available for members under 18. You can still ask the coach general questions."
        : "Meal and workout plans use your FITX data. Turn on “Use my FITX data” in the coach's settings to get them.",
    );
  }
  // Check the switch and keys before taking anything from today's limit.
  if (safety.kind === "ok") planOrThrow(deps.router, task === "chat" ? "chat" : task);

  const kind = task === "chat" ? "chat" : "plan";
  const ticket = safety.kind === "ok" ? await store.takeQuota(deps.db, kind) : null;
  if (ticket && !ticket.allowed) {
    throw new CoachError(
      "quota",
      kind === "plan" ? `You've used today's ${ticket.quota.limit} plans.` : `You've used today's ${ticket.quota.limit} coach messages.`,
      ticket.quota.resetsAt || undefined,
    );
  }

  let thread: { id: string; title: string } | null = null;
  let createdThread = false;
  let userMessage: CoachMessageView | null = null;
  try {
    if (input.threadId) {
      thread = await store.getThread(deps.db, deps.userId, input.threadId);
      if (!thread) throw new CoachError("not_found", "That conversation no longer exists.");
    } else {
      thread = await store.createThread(deps.db, deps.userId, titleFrom(input.message, task));
      createdThread = true;
    }
    userMessage = await store.insertMessage(deps.db, deps.userId, { threadId: thread.id, role: "user", task, content: input.message });
    emit({ type: "thread", threadId: thread.id, title: thread.title, userMessageId: userMessage.id });
    if (task !== "chat") emit({ type: "task", task });

    if (safety.kind === "stop") {
      const note = await store.insertMessage(deps.db, deps.userId, { threadId: thread.id, role: "safety", task: "chat", content: safety.message });
      await store.touchThread(deps.db, deps.userId, thread.id);
      emit({ type: "message", message: note, actions: [] });
      emit({ type: "done", quota: null });
      return;
    }

    const context = consent.shareData && !basicFacts.minor ? buildCoachContext(await loadContextSources(deps.db, deps.userId, now, { full: true }), now) : buildCoachContext(basics, now);
    const turnState = { ...deps, thread, context, sharesData: consent.shareData && !basicFacts.minor, cautions: safety.cautions, input };
    let reply: { message: CoachMessageView; actions: CoachActionView[] };
    if (task === "meal_plan") reply = await mealPlanTurn(turnState, emit);
    else if (task === "workout_plan") reply = await workoutTurn(turnState, emit);
    else reply = await chatTurn(turnState, emit);

    await store.touchThread(deps.db, deps.userId, thread.id);
    emit({ type: "message", ...reply });
    emit({ type: "done", quota: ticket?.quota ?? null });
  } catch (error) {
    // Nothing answered: hand the request back and leave no half conversation behind.
    if (ticket) await store.releaseQuota(deps.db, ticket.eventId);
    if (thread && createdThread) await store.deleteThread(deps.db, deps.userId, thread.id).catch(() => {});
    else if (userMessage) await store.deleteMessage(deps.db, deps.userId, userMessage.id);
    throw toCoachError(error);
  }
}

type TurnState = CoachDeps & {
  thread: { id: string; title: string };
  context: CoachContext;
  sharesData: boolean;
  cautions: SafetyCaution[];
  input: TurnInput;
};

async function chatTurn(state: TurnState, emit: Emit) {
  const history = await store.recentTurns(state.db, state.userId, state.thread.id);
  const result = await state.router.stream(
    {
      task: "chat",
      system: chatSystemPrompt({ context: state.context, facts: state.context.facts, sharesData: state.sharesData }),
      messages: historyTurns(history),
      maxOutputTokens: 2048,
      temperature: 0.6,
    },
    { signal: state.signal, onDelta: (text) => emit({ type: "delta", text }), onReset: () => emit({ type: "reset" }) },
  );
  const content = cleanMultiline(result.text, 11000);
  if (!content) throw new AiUnavailableError("at_capacity", result.attempts);
  const notes = cautionNotes(state.cautions);
  const message = await store.insertMessage(state.db, state.userId, {
    threadId: state.thread.id,
    role: "assistant",
    task: "chat",
    content,
    data: notes.length ? { notes } : null,
    provider: PROVIDER_LABELS[result.provider],
    model: result.model,
  });
  return { message, actions: [] };
}

async function mealPlanTurn(state: TurnState, emit: Emit) {
  const facts = state.context.facts;
  emit({ type: "status", text: "Reading your goals, diet and food log" });
  const mealsPerDay = Number((state.context.summary.food_preferences as Record<string, unknown> | undefined)?.meals_per_day) || null;
  emit({ type: "status", text: "Asking the coach for a plan" });
  const result = await state.router.json(
    {
      task: "meal_plan",
      system: mealPlanSystemPrompt({ context: state.context, facts, sharesData: true, mealsPerDay, budgetNote: state.input.budgetNote }),
      messages: [{ role: "user", content: memberTurn("member_request", requestText(state.input)) }],
      maxOutputTokens: 6144,
      temperature: 0.5,
      json: { name: "meal_plan", schema: MEAL_PLAN_SCHEMA },
    },
    (value) => dietSafePlan(parseMealPlan(value), facts),
    { signal: state.signal },
  );

  emit({ type: "status", text: "Checking every food against FITX's nutrition data" });
  const live = state.live;
  const grounded = await Promise.all(
    result.value.plan.meals.map((meal) => Promise.all(meal.items.map((item) => groundFood(item, { catalogue: state.catalogue(), live, diet: facts.diet, allergies: facts.allergies })))),
  );
  const built = buildMealPlan(result.value.plan, grounded, facts, state.input.budgetNote, result.value.removed);
  const messageId = crypto.randomUUID();
  const notes = cautionNotes(state.cautions);
  const message = await store.insertMessage(state.db, state.userId, {
    id: messageId,
    threadId: state.thread.id,
    role: "assistant",
    task: "meal_plan",
    content: planText(built.plan),
    data: { plan: built.plan, ...(notes.length ? { notes } : {}) },
    provider: PROVIDER_LABELS[result.provider],
    model: result.model,
  });
  await saveProposals(state, messageId, built.actions);
  return { message, actions: built.actions.map((action) => ({ id: action.id, messageId, kind: action.kind, status: "proposed" as const, swap: null })) };
}

async function workoutTurn(state: TurnState, emit: Emit) {
  const facts = state.context.facts;
  emit({ type: "status", text: "Finding exercises that fit your equipment" });
  const candidates = await exerciseCandidates(state.db, facts);
  if (candidates.length < 4) {
    throw new CoachError("failed", "FITX's exercise library has too few exercises for your equipment and location. Check them in Profile.");
  }
  const byId = new Map(candidates.map((exercise) => [exercise.id, exercise]));
  emit({ type: "status", text: "Asking the coach for a session" });
  const result = await state.router.json(
    {
      task: "workout_plan",
      system: workoutSystemPrompt({ context: state.context, facts, sharesData: true, candidates }),
      messages: [{ role: "user", content: memberTurn("member_request", requestText(state.input)) }],
      maxOutputTokens: 4096,
      temperature: 0.5,
      json: { name: "workout", schema: WORKOUT_SCHEMA },
    },
    (value) => parseWorkout(value, new Set(byId.keys())),
    { signal: state.signal },
  );
  const actionId = crypto.randomUUID();
  const workout = result.value;
  const plan: CoachWorkoutPlan = {
    kind: "workout_plan",
    title: workout.title,
    summary: workout.summary,
    location: facts.location,
    exercises: workout.exercises.map((exercise) => {
      const known = byId.get(exercise.id)!;
      return { exerciseId: exercise.id, name: known.name, primaryMuscle: known.primary_muscle, equipment: known.equipment, sets: exercise.sets, repsMin: exercise.repsMin, repsMax: exercise.repsMax, restSeconds: exercise.restSeconds, holdSeconds: exercise.holdSeconds, note: exercise.note };
    }),
    tips: workout.tips,
    checks: ["Every exercise is from FITX's exercise library and fits the equipment and location in your profile."],
    actionId,
  };
  const messageId = crypto.randomUUID();
  const notes = cautionNotes(state.cautions);
  const message = await store.insertMessage(state.db, state.userId, {
    id: messageId,
    threadId: state.thread.id,
    role: "assistant",
    task: "workout_plan",
    content: `Workout: ${plan.title}. ${plan.summary} ${plan.exercises.map((exercise) => `${exercise.name} ${exercise.sets}×${exercise.holdSeconds ? `${exercise.holdSeconds}s` : `${exercise.repsMin}-${exercise.repsMax}`}`).join("; ")}.`.slice(0, 2000),
    data: { plan, ...(notes.length ? { notes } : {}) },
    provider: PROVIDER_LABELS[result.provider],
    model: result.model,
  });
  const payload = {
    workout: {
      title: plan.title,
      location: ["gym", "home", "both", "outdoor"].includes(facts.location) ? facts.location : "gym",
      exercises: plan.exercises.map((exercise) => ({ exercise_id: exercise.exerciseId, exercise_name: exercise.name, sets: exercise.sets, reps_min: exercise.repsMin, reps_max: exercise.repsMax, rest_seconds: exercise.restSeconds, hold_seconds: exercise.holdSeconds ?? 0 })),
    },
  };
  await saveProposals(state, messageId, [{ id: actionId, kind: "workout_plan", payload }]);
  return { message, actions: [{ id: actionId, messageId, kind: "workout_plan" as const, status: "proposed" as const, swap: null }] };
}

/** Saves a plan's buttons; if that fails, the plan message goes too, so no button points at nothing. */
async function saveProposals(state: TurnState, messageId: string, actions: store.NewAction[]) {
  try {
    await store.insertActions(state.db, state.userId, state.thread.id, messageId, actions);
  } catch (error) {
    await store.deleteMessage(state.db, state.userId, messageId);
    throw error;
  }
}

/** "Can't afford this?": a cheaper or easier-to-find replacement with similar calories and protein, checked by FITX. */
export async function runSwap(deps: CoachDeps, input: { actionId: string; note: string | null }): Promise<{ swap: CoachSwap; action: CoachActionView; quota: CoachQuota }> {
  const now = deps.now?.() ?? new Date();
  const consent = await store.getConsent(deps.db, deps.userId);
  if (!consent) throw new CoachError("consent_required", "Agree to how the coach uses your data first.");
  const original = await store.getAction(deps.db, deps.userId, input.actionId);
  const item = original?.payload?.item as CoachFoodItem | undefined;
  if (!original || original.kind !== "food" || !item || typeof item.calories !== "number") throw new CoachError("not_found", "That food is no longer in your plan.");
  if (input.note) {
    const safety = screenMessage(input.note);
    if (safety.kind === "stop") throw new CoachError("refused", safety.message);
  }

  const context = buildCoachContext(await loadContextSources(deps.db, deps.userId, now, { full: consent.shareData }), now);
  if (!consent.shareData || context.facts.minor) throw new CoachError("plans_unavailable", "Swaps use your FITX data. Turn on “Use my FITX data” in the coach's settings.");
  planOrThrow(deps.router, "swap");
  const ticket = await store.takeQuota(deps.db, "chat");
  if (!ticket.allowed) throw new CoachError("quota", `You've used today's ${ticket.quota.limit} coach messages.`, ticket.quota.resetsAt || undefined);

  try {
    const facts = context.facts;
    const mealName = typeof original.payload.meal === "string" ? original.payload.meal : "meal";
    const request = `Replace: ${item.name}, ${item.portion}, about ${item.calories} kcal and ${item.protein} g protein, in their ${mealName}.`;
    const result = await deps.router.json(
      {
        task: "swap",
        system: swapSystemPrompt({ context, facts, sharesData: true }),
        messages: [{ role: "user", content: `${request}\n${memberTurn("member_note", input.note ?? "The member did not say what they can get instead.")}` }],
        maxOutputTokens: 2048,
        temperature: 0.5,
        json: { name: "swap", schema: SWAP_SCHEMA },
      },
      (value) => {
        const parsed = parseSwap(value);
        const options = parsed?.options.filter((option) => !foodConflict(`${option.name} ${option.search}`, facts.diet, facts.allergies) && normalize(option.name) !== normalize(item.name));
        return options?.length ? options : null;
      },
      { signal: deps.signal },
    );
    const grounded = await Promise.all(result.value.map((option) => groundFood(option, { catalogue: deps.catalogue(), live: deps.live, diet: facts.diet, allergies: facts.allergies })));
    const choice = pickSwap(item, grounded, result.value.map((option) => option.why));
    const actionId = crypto.randomUUID();
    const swap: CoachSwap = { kind: "swap", replaces: original.id, item: { ...choice.food.item, key: actionId, actionId }, note: choice.note };
    await store.insertActions(deps.db, deps.userId, original.thread_id, original.message_id, [
      { id: actionId, kind: "food", payload: { custom_food: customFoodFor(choice.food.item, choice.food.per100), item: swap.item, meal: mealName, swap } },
    ]);
    return { swap, action: { id: actionId, messageId: original.message_id, kind: "food", status: "proposed", swap }, quota: ticket.quota };
  } catch (error) {
    await store.releaseQuota(deps.db, ticket.eventId);
    throw toCoachError(error);
  }
}

/** Applies a proposal the member pressed. Idempotent: pressing twice returns the first row. */
export async function applyProposal(db: store.Db, userId: string, actionId: string) {
  const action = await store.getAction(db, userId, actionId);
  if (!action) throw new CoachError("not_found", "That suggestion is no longer available.");
  if (action.status === "dismissed") throw new CoachError("invalid", "That suggestion was dismissed.");
  try {
    const applied = await store.applyAction(db, actionId);
    return { kind: action.kind, refId: applied.refId, already: applied.already };
  } catch (error) {
    throw toCoachError(error);
  }
}

function planOrThrow(router: AiRouter, task: AiTask) {
  try {
    router.candidates(task);
  } catch (error) {
    throw toCoachError(error);
  }
}

/** Filters a parsed plan through the member's diet and allergy rules. Too many breaches and the model's plan is rejected. */
function dietSafePlan(plan: ModelMealPlan | null, facts: MemberFacts): { plan: ModelMealPlan; removed: string[] } | null {
  if (!plan) return null;
  const removed: string[] = [];
  const meals = plan.meals
    .map((meal) => ({
      ...meal,
      items: meal.items.filter((item) => {
        const conflict = foodConflict(`${item.name} ${item.search} ${item.brand ?? ""}`, facts.diet, facts.allergies);
        if (conflict) removed.push(`${item.name}: ${conflict}`);
        return !conflict;
      }),
    }))
    .filter((meal) => meal.items.length);
  const kept = meals.reduce((sum, meal) => sum + meal.items.length, 0);
  if (kept < 3 || removed.length > kept / 2) return null;
  return { plan: { ...plan, meals }, removed };
}

function buildMealPlan(model: ModelMealPlan, grounded: GroundedFood[][], facts: MemberFacts, budgetNote: string | null, removed: string[]) {
  const checks: string[] = removed.map((line) => `Left out ${line}.`);
  let foods = grounded.map((meal) => meal.slice());
  const target = facts.target;
  const total = () => foods.flat().reduce((sum, food) => sum + food.item.calories, 0);

  if (target && total() > 0) {
    const ratio = total() / target.calories;
    if (ratio < 0.9 || ratio > 1.1) {
      const fixed = foods.flat().filter((food) => !food.scalable).reduce((sum, food) => sum + food.item.calories, 0);
      const scalable = total() - fixed;
      if (scalable > 0) {
        const factor = Math.min(1.35, Math.max(0.75, (target.calories - fixed) / scalable));
        foods = foods.map((meal) => meal.map((food) => resize(food, factor)));
        checks.push(`FITX resized gram portions so the day comes closer to your target of about ${target.calories.toLocaleString("en-IN")} kcal.`);
      }
    }
    const after = total();
    const gap = after - target.calories;
    if (Math.abs(gap) > target.calories * 0.15) {
      checks.push(`This plan comes to about ${after.toLocaleString("en-IN")} kcal, ${Math.abs(gap).toLocaleString("en-IN")} kcal ${gap < 0 ? "below" : "above"} your daily target. ${gap < 0 ? "Add a snack or larger portions." : "Use smaller portions."}`);
    }
    const protein = Math.round(foods.flat().reduce((sum, food) => sum + food.item.protein, 0));
    if (protein < target.protein * 0.85) {
      const ideas = ["dal", "chana", "curd", "paneer", "tofu", "eggs", "chicken", "fish"].filter((food) => !foodConflict(food, facts.diet, facts.allergies)).slice(0, 3);
      checks.push(`Protein comes to about ${protein} g, under your target of ${target.protein} g.${ideas.length ? ` A little more ${ideas.join(", ")} would close the gap.` : ""}`);
    }
  }
  const estimates = foods.flat().filter((food) => food.item.basis === "ai_estimate").length;
  if (estimates) checks.push(`${estimates === 1 ? "One food isn't" : `${estimates} foods aren't`} in FITX's nutrition data yet, so ${estimates === 1 ? "its values are" : "their values are"} the coach's estimate${estimates === 1 ? "" : "s"}.`);

  const actions: store.NewAction[] = [];
  const meals: CoachMeal[] = model.meals.map((meal, mealIndex) => {
    const items: CoachFoodItem[] = foods[mealIndex].map((food) => {
      const id = crypto.randomUUID();
      const item: CoachFoodItem = { ...food.item, key: id, actionId: id };
      actions.push({ id, kind: "food", payload: { custom_food: customFoodFor(food.item, food.per100), item, meal: meal.name } });
      return item;
    });
    const mealFood = customMealFor(meal.name, items);
    const mealActionId = items.length > 1 && mealFood ? crypto.randomUUID() : null;
    if (mealActionId && mealFood) actions.push({ id: mealActionId, kind: "meal", payload: { custom_food: mealFood, meal: meal.name } });
    return { key: `meal-${mealIndex}`, name: meal.name, items, totals: sumItems(items), actionId: mealActionId };
  });
  const plan: CoachMealPlan = {
    kind: "meal_plan",
    title: model.title,
    summary: model.summary,
    meals,
    totals: sumItems(meals.flatMap((meal) => meal.items)),
    target,
    budget: budgetNote ?? facts.budget,
    tips: model.tips,
    checks,
  };
  return { plan, actions };
}

/** Picks the first replacement within 20% of the calories and close on protein, resizing gram portions to match. */
function pickSwap(original: CoachFoodItem, options: GroundedFood[], reasons: Array<string | null>) {
  const scored = options.map((food, index) => {
    const factor = food.item.calories > 0 ? Math.min(2, Math.max(0.5, original.calories / food.item.calories)) : 1;
    const sized = resize(food, factor);
    const calorieGap = original.calories > 0 ? Math.abs(sized.item.calories - original.calories) / original.calories : 0;
    const proteinGap = Math.abs(sized.item.protein - original.protein);
    const fits = calorieGap <= 0.2 && proteinGap <= Math.max(5, original.protein * 0.3);
    return { food: sized, fits, score: calorieGap + proteinGap / Math.max(10, original.protein), why: reasons[index] };
  });
  const best = scored.find((option) => option.fits) ?? scored.slice().sort((a, b) => a.score - b.score)[0];
  const item = best.food.item;
  const kcalGap = item.calories - original.calories;
  const proteinGap = round1(item.protein - original.protein);
  const note = best.fits
    ? `${best.why ? `${best.why} ` : ""}Similar to the original: ${item.calories} kcal and ${item.protein} g protein against ${original.calories} kcal and ${original.protein} g.`
    : `The closest swap FITX found: ${Math.abs(kcalGap)} kcal ${kcalGap < 0 ? "less" : "more"} and ${Math.abs(proteinGap)} g ${proteinGap < 0 ? "less" : "more"} protein than the original.`;
  return { food: best.food, note };
}

async function exerciseCandidates(db: store.Db, facts: MemberFacts): Promise<ExerciseCandidate[]> {
  const { data, error } = await db.from("exercise_library").select("id, name, primary_muscle, equipment, locations, difficulty").eq("is_active", true).limit(1200);
  if (error || !Array.isArray(data)) return [];
  const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const available = new Set(facts.equipment.map(normalizeName));
  available.add("bodyweight");
  const location = facts.location;
  const eligible = (data as Array<ExerciseCandidate & { locations: string[] }>).filter((exercise) => {
    const locations = Array.isArray(exercise.locations) ? exercise.locations : [];
    const placeFits = locations.includes(location) || (location === "both" && (locations.includes("home") || locations.includes("gym")));
    const kitFits = (Array.isArray(exercise.equipment) ? exercise.equipment : []).every((item) => available.has(normalizeName(item)));
    const levelFits = facts.level === "advanced" || exercise.difficulty !== "advanced";
    return placeFits && kitFits && levelFits;
  });
  // A different, stable order each day, so suggestions vary without changing within a day.
  const daily = (id: string) => [...`${facts.today}:${id}`].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
  const rested = (muscle: string) => (facts.recentMuscles.includes(muscle) ? 1 : 0);
  const byMuscle = new Map<string, ExerciseCandidate[]>();
  for (const exercise of eligible.sort((a, b) => rested(a.primary_muscle) - rested(b.primary_muscle) || daily(a.id) - daily(b.id))) {
    const group = byMuscle.get(exercise.primary_muscle) ?? [];
    if (group.length < 5) group.push({ id: exercise.id, name: exercise.name, primary_muscle: exercise.primary_muscle, equipment: exercise.equipment ?? [], difficulty: exercise.difficulty });
    byMuscle.set(exercise.primary_muscle, group);
  }
  return [...byMuscle.values()].flat().slice(0, 60);
}

function requestText(input: TurnInput) {
  const parts = [input.message];
  if (input.budgetNote) parts.push(`Budget for this plan: ${input.budgetNote}`);
  return parts.join("\n");
}

function planText(plan: CoachMealPlan) {
  const meals = plan.meals.map((meal) => `${meal.name}: ${meal.items.map((item) => `${item.name} (${item.portion})`).join(", ")}`).join(" · ");
  return `Meal plan: ${plan.title}. ${plan.summary} ${meals}. About ${plan.totals.calories} kcal and ${plan.totals.protein} g protein.`.slice(0, 3000);
}

function titleFrom(message: string, task: string) {
  if (task === "meal_plan" && /^plan my meals/i.test(message)) return "Meal plan";
  if (task === "workout_plan" && /^plan a workout/i.test(message)) return "Workout plan";
  return cleanText(message, 60) ?? "Conversation";
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function toCoachError(error: unknown): CoachError {
  if (error instanceof CoachError) return error;
  if (error instanceof AiUnavailableError) {
    const retryAt = error.retryAt ? new Date(error.retryAt).toISOString() : undefined;
    if (error.reason === "disabled") return new CoachError("paused", "The AI coach is paused right now.");
    if (error.reason === "not_configured") return new CoachError("not_configured", "The AI coach isn't switched on yet.");
    if (error.reason === "refused") return new CoachError("refused", "The AI services declined to answer that. Try asking in a different way.");
    return new CoachError("at_capacity", "The free AI services FITX uses are busy or not answering right now.", retryAt);
  }
  if (error instanceof store.CoachStoreError) {
    if (error.code === "not_available") return new CoachError("not_available", "The AI coach isn't available yet.");
    if (error.code === "not_found") return new CoachError("not_found", "That item no longer exists.");
    if (error.code === "invalid") return new CoachError("invalid", "That request couldn't be completed.");
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return new CoachError("failed", "The request was stopped.");
  return new CoachError("failed", "Something went wrong. Nothing was changed; please try again.");
}
