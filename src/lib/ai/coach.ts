import "server-only";
import { loadCatalog, loadEquipmentProfiles, ownedEquipmentSet } from "@/lib/training/data";
import { equipmentLabel, isDoableWith } from "@/lib/training/equipment";
import type { TrainingContext } from "@/lib/training/taxonomy";
import type { AiConfig } from "./config";
import { buildCoachContext, loadContextSources, type CoachContext, type MemberFacts } from "./context";
import { describeAllergies, foodConflict } from "./diet-rules";
import type { CatalogueFood } from "./food-catalogue";
import type { LiveLookups } from "./food-lookup";
import { customFoodFor, customMealFor, groundFood, isConflict, resize, sumItems, type GroundedFood, type GroundingConflict } from "./grounding";
import { MEAL_PLAN_SCHEMA, SWAP_SCHEMA, WORKOUT_SCHEMA, parseMealPlan, parseSwap, parseWorkout, type ModelMealPlan } from "./plans";
import { chatSystemPrompt, historyTurns, mealPlanSystemPrompt, memberTurn, swapSystemPrompt, workoutSystemPrompt, type ExerciseCandidate } from "./prompts";
import { PROVIDER_LABELS } from "./registry";
import { AiUnavailableError, type AiRouter } from "./router";
import { CARE_DAYS, cautionNotes, screenMessage, type SafetyCaution } from "./safety";
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
  /** Milliseconds since epoch; tests replace it. */
  clock?: () => number;
};

export type TurnInput = { threadId: string | null; message: string; mode: "chat" | "meal_plan" | "workout_plan"; budgetNote: string | null };
type Emit = (event: CoachStreamEvent) => void;

export const MESSAGE_MAX = 2000;

/**
 * Time budget for one turn. The route may run for 60 s (maxDuration); the model gets what is left of
 * ~45 s, and live food lookups are skipped when less than ~12 s remain, so the clean-up (handing the
 * request back, removing a half conversation) always runs before the platform stops the function.
 */
const TURN_BUDGET_MS = 45_000;
const MIN_MODEL_MS = 15_000;
const LIVE_LOOKUP_MIN_MS = 12_000;

/** The account agreed to "Use my FITX data" as an adult and its profile now says under 18. */
const AGE_CHANGED = "Your profile now says you're under 18, so the coach needs your OK again before it answers. It will answer general questions only.";
/** The account agreed to "Use my FITX data" and the age has since been removed from its profile. */
const AGE_MISSING = "Your profile no longer has your age, so the coach needs your OK again before it answers. Until you add your age in Profile, it answers general questions only.";
/** Why the coach is asking for consent again, when needsNewConsent says it must. */
const askAgain = (facts: Pick<MemberFacts, "minor">) => (facts.minor ? AGE_CHANGED : AGE_MISSING);

/** Kind, fixed wording for plans FITX won't make, and why. */
const NO_PLAN = {
  care: "For 30 days after FITX's note about eating, the coach doesn't make meal plans or swaps, or give calorie targets. It's here for gentle, general questions in the meantime.",
  medical: "With a medical condition, a meal plan should come from your doctor or a registered dietitian, so FITX Coach won't make one. You can still ask it general questions.",
  pregnancy: "During pregnancy or while breastfeeding, meal and workout plans should come from your doctor or midwife, so FITX Coach won't make one. You can still ask it general questions.",
} as const;

/** Messages that clearly ask for a whole plan go to the checked plan tasks instead of free chat. */
export function detectTask(text: string): "chat" | "meal_plan" | "workout_plan" {
  const asks = /\b(make|create|give|build|suggest|need|want|write|design|prepare|generate|draft|recommend|can you|could you)\b/i.test(text);
  if (/\bwhat should i eat (today|tomorrow)\b/i.test(text) || /^\s*plan (my|a|the|today'?s|tomorrow'?s)?\s*(meals?|food|diet|day of eating)\b/i.test(text)) return "meal_plan";
  if (asks && /\b(meal|food|diet|eating|nutrition)\s+plan\b/i.test(text)) return "meal_plan";
  if (/^\s*plan (my|a|the|today'?s)?\s*workout\b/i.test(text)) return "workout_plan";
  if (asks && /\b(workout|training|exercise|gym)\s+(plan|routine|session|program|programme)\b/i.test(text)) return "workout_plan";
  return "chat";
}

/** Why FITX won't make this plan for this member right now, or null when it may. */
function planBlock(task: "meal_plan" | "workout_plan" | "swap", careMode: boolean, cautions: readonly SafetyCaution[]): string | null {
  if (task !== "workout_plan" && careMode) return NO_PLAN.care;
  if (cautions.includes("pregnancy")) return NO_PLAN.pregnancy;
  if (task !== "workout_plan" && cautions.includes("medical")) return NO_PLAN.medical;
  return null;
}

export async function runCoachTurn(deps: CoachDeps, input: TurnInput, emit: Emit): Promise<void> {
  const clock = deps.clock ?? Date.now;
  const startedAt = clock();
  const now = deps.now?.() ?? new Date();
  const consent = await store.getConsent(deps.db, deps.userId);
  if (!consent) throw new CoachError("consent_required", "Agree to how the coach uses your data first.");

  const basics = await loadContextSources(deps.db, deps.userId, now, { full: false });
  const basicFacts = buildCoachContext(basics, now).facts;
  if (store.needsNewConsent(consent, basicFacts.adult)) throw new CoachError("consent_required", askAgain(basicFacts));
  const safety = screenMessage(input.message, { floor: basicFacts.calorieFloor });
  // Only an account whose profile says 18 or over shares its data, whatever the consent says.
  const sharesData = consent.shareData && basicFacts.adult;
  const plansAllowed = sharesData;

  // What earlier messages said still counts: an eating-disorder note pauses meal plans for 30 days
  // (account-wide), and pregnancy or a medical condition raised in this conversation stops plans in it.
  const [careMode, threadCautions] = await Promise.all([
    store.hasRecentSafetyNote(deps.db, deps.userId, "eating_disorder", CARE_DAYS),
    input.threadId ? store.recentCautions(deps.db, deps.userId, input.threadId) : Promise.resolve([] as SafetyCaution[]),
  ]);
  const cautions = safety.kind === "ok" ? [...new Set([...safety.cautions, ...threadCautions])] : threadCautions;

  let task: TurnInput["mode"] = input.mode;
  const asked = task !== "chat";
  if (task === "chat" && plansAllowed && safety.kind === "ok") task = detectTask(input.message);
  if (task !== "chat" && !plansAllowed) {
    throw new CoachError(
      "plans_unavailable",
      basicFacts.minor
        ? "Meal and workout plans aren't available for members under 18. You can still ask the coach general questions."
        : !basicFacts.adult
          ? "Meal and workout plans use your FITX data, which the coach uses only once your profile has your age. Add your age in Profile, then turn on “Use my FITX data” in the coach's settings."
          : "Meal and workout plans use your FITX data. Turn on “Use my FITX data” in the coach's settings to get them.",
    );
  }
  if (task !== "chat" && safety.kind === "ok") {
    const blocked = planBlock(task, careMode, cautions);
    // A plan the member asked for with the button gets the honest reason; a question that only looked like a
    // plan request ("what should I eat today?") is answered as a question instead.
    if (blocked && asked) throw new CoachError("plans_unavailable", blocked);
    if (blocked) task = "chat";
  }
  const personalData = task !== "chat" || sharesData;
  // Check the switch and keys before taking anything from today's limit.
  if (safety.kind === "ok") planOrThrow(deps.router, task, personalData);

  let ticket = safety.kind === "ok" ? await store.takeQuota(deps.db, task === "chat" ? "chat" : "plan") : null;
  if (ticket && !ticket.allowed && task !== "chat" && !asked) {
    // The plan allowance is used up, but this was typed as a question: answer it as one.
    task = "chat";
    ticket = await store.takeQuota(deps.db, "chat");
  }
  if (ticket && !ticket.allowed) {
    throw new CoachError(
      "quota",
      task === "chat" ? `You've used your ${ticket.quota.limit} coach messages for the last 24 hours.` : `You've used your ${ticket.quota.limit} plans for the last 24 hours.`,
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
    userMessage = await store.insertMessage(deps.db, deps.userId, {
      threadId: thread.id,
      role: "user",
      task,
      content: input.message,
      // A stopped message is marked so it never reaches a model in a later turn either.
      data: safety.kind === "stop" ? { safetyStop: safety.topic } : safety.cautions.length ? { cautions: safety.cautions } : null,
    });
    emit({ type: "thread", threadId: thread.id, title: thread.title, userMessageId: userMessage.id });
    if (task !== "chat") emit({ type: "task", task });

    if (safety.kind === "stop") {
      const note = await store.insertMessage(deps.db, deps.userId, { threadId: thread.id, role: "safety", task: "chat", content: safety.message, data: { safety: safety.topic } });
      // The 30 days after the eating-disorder note also hold when this conversation is deleted. If keeping
      // that record fails, the note in the conversation still starts them: the member sees it either way.
      if (safety.topic === "eating_disorder") await store.recordSafetyNote(deps.db, deps.userId, "eating_disorder").catch(() => undefined);
      await store.touchThread(deps.db, deps.userId, thread.id);
      emit({ type: "message", message: note, actions: [] });
      emit({ type: "done", quota: null });
      return;
    }

    const full = sharesData ? buildCoachContext(await loadContextSources(deps.db, deps.userId, now, { full: true }), now) : buildCoachContext(basics, now);
    const context = careMode ? withoutCalorieNumbers(full) : full;
    // Without "Use my FITX data", the conversation so far is sent only from when it was switched off, so the
    // coach's earlier replies built from the member's data do not go out again.
    const historySince = consent.shareData ? null : consent.updatedAt ?? consent.consentedAt;
    const turnState: TurnState = {
      ...deps,
      thread,
      context,
      sharesData,
      careMode,
      cautions,
      historySince,
      userMessageId: userMessage.id,
      input,
      deadline: startedAt + TURN_BUDGET_MS,
      clock,
    };
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
  careMode: boolean;
  /** Earlier messages from before this time are left out of the request (null: none are). */
  historySince: string | null;
  /** The member's message being answered. */
  userMessageId: string;
  cautions: SafetyCaution[];
  input: TurnInput;
  /** When this turn's model and food checks must be done (ms since epoch). */
  deadline: number;
  clock: () => number;
};

/** What the model may still use (at least MIN_MODEL_MS, which the route's 60 s still covers). */
function modelBudget(state: { deadline: number; clock: () => number }) {
  return Math.max(MIN_MODEL_MS, state.deadline - state.clock());
}

async function chatTurn(state: TurnState, emit: Emit) {
  const history = await store.recentTurns(state.db, state.userId, state.thread.id, { since: state.historySince, keep: state.userMessageId });
  const result = await state.router.stream(
    {
      task: "chat",
      system: chatSystemPrompt({ context: state.context, facts: state.context.facts, sharesData: state.sharesData, careMode: state.careMode }),
      messages: historyTurns(history),
      maxOutputTokens: 2048,
      temperature: 0.6,
      personalData: state.sharesData,
    },
    { signal: state.signal, deadlineMs: modelBudget(state), onDelta: (text) => emit({ type: "delta", text }), onReset: () => emit({ type: "reset" }) },
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
      personalData: true,
    },
    (value) => dietSafePlan(parseMealPlan(value), facts),
    { signal: state.signal, deadlineMs: modelBudget(state) },
  );

  emit({ type: "status", text: "Checking every food against FITX's nutrition data" });
  // Live lookups (Open Food Facts, USDA) only when there is time left for them; the local data always runs.
  const live = state.deadline - state.clock() > LIVE_LOOKUP_MIN_MS ? state.live : undefined;
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
  const candidates = await exerciseCandidates(state.db, state.userId, facts);
  if (candidates.length < 4) {
    throw new CoachError("failed", "FITX's exercise library has too few exercises for your equipment and location. Check them in Workouts or Profile.");
  }
  const byId = new Map(candidates.map((exercise) => [exercise.id, exercise]));
  emit({ type: "status", text: "Asking the coach for a session" });
  const result = await state.router.json(
    {
      task: "workout_plan",
      system: workoutSystemPrompt({ context: state.context, facts, sharesData: true, candidates, careMode: state.careMode }),
      messages: [{ role: "user", content: memberTurn("member_request", requestText(state.input)) }],
      maxOutputTokens: 4096,
      temperature: 0.5,
      json: { name: "workout", schema: WORKOUT_SCHEMA },
      personalData: true,
    },
    (value) => parseWorkout(value, new Set(byId.keys())),
    { signal: state.signal, deadlineMs: modelBudget(state) },
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
      // A timed exercise from the library keeps a hold time even if the model forgot to give one.
      const holdSeconds = exercise.holdSeconds ?? (known.prescription === "time" ? 30 : null);
      return {
        exerciseId: exercise.id,
        name: known.name,
        primaryMuscle: known.muscle,
        equipment: known.equipment,
        sets: exercise.sets,
        repsMin: holdSeconds ? 1 : exercise.repsMin,
        repsMax: holdSeconds ? 1 : exercise.repsMax,
        restSeconds: exercise.restSeconds,
        holdSeconds,
        note: exercise.note,
      };
    }),
    tips: workout.tips,
    checks: ["Every exercise is from FITX's exercise library and fits the equipment and place you train."],
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
  const clock = deps.clock ?? Date.now;
  const startedAt = clock();
  const now = deps.now?.() ?? new Date();
  const consent = await store.getConsent(deps.db, deps.userId);
  if (!consent) throw new CoachError("consent_required", "Agree to how the coach uses your data first.");
  const original = await store.getAction(deps.db, deps.userId, input.actionId);
  const item = original?.payload?.item as CoachFoodItem | undefined;
  if (!original || original.kind !== "food" || !item || typeof item.calories !== "number") throw new CoachError("not_found", "That food is no longer in your plan.");

  const context = buildCoachContext(await loadContextSources(deps.db, deps.userId, now, { full: consent.shareData }), now);
  if (store.needsNewConsent(consent, context.facts.adult)) throw new CoachError("consent_required", askAgain(context.facts));
  if (!consent.shareData || !context.facts.adult) throw new CoachError("plans_unavailable", "Swaps use your FITX data. Turn on “Use my FITX data” in the coach's settings.");
  const noteSafety = input.note ? screenMessage(input.note, { floor: context.facts.calorieFloor }) : null;
  if (noteSafety?.kind === "stop") throw new CoachError("refused", noteSafety.message);
  const [careMode, threadCautions] = await Promise.all([
    store.hasRecentSafetyNote(deps.db, deps.userId, "eating_disorder", CARE_DAYS),
    store.recentCautions(deps.db, deps.userId, original.thread_id),
  ]);
  const blocked = planBlock("swap", careMode, [...threadCautions, ...(noteSafety?.kind === "ok" ? noteSafety.cautions : [])]);
  if (blocked) throw new CoachError("plans_unavailable", blocked);
  planOrThrow(deps.router, "swap", true);
  const ticket = await store.takeQuota(deps.db, "chat");
  if (!ticket.allowed) throw new CoachError("quota", `You've used your ${ticket.quota.limit} coach messages for the last 24 hours.`, ticket.quota.resetsAt || undefined);

  try {
    const facts = context.facts;
    const deadline = startedAt + TURN_BUDGET_MS;
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
        personalData: true,
      },
      (value) => {
        const parsed = parseSwap(value);
        const options = parsed?.options.filter((option) => !foodConflict(`${option.name} ${option.search} ${option.brand ?? ""}`, facts.diet, facts.allergies) && normalize(option.name) !== normalize(item.name));
        return options?.length ? options : null;
      },
      { signal: deps.signal, deadlineMs: modelBudget({ deadline, clock }) },
    );
    const live = deadline - clock() > LIVE_LOOKUP_MIN_MS ? deps.live : undefined;
    const outcomes = await Promise.all(result.value.map((option) => groundFood(option, { catalogue: deps.catalogue(), live, diet: facts.diet, allergies: facts.allergies })));
    const usable = outcomes.map((outcome, index) => ({ outcome, why: result.value[index].why })).filter((entry): entry is { outcome: GroundedFood; why: string | null } => !isConflict(entry.outcome));
    if (!usable.length) throw new CoachError("failed", "FITX couldn't find a swap that fits your diet and allergies. Try telling the coach what you can get.");
    const choice = pickSwap(item, usable.map((entry) => entry.outcome), usable.map((entry) => entry.why));
    const actionId = crypto.randomUUID();
    const swapItem: CoachFoodItem = { ...choice.food.item, key: actionId, actionId, note: allergyNote(choice.food, facts) ?? choice.food.item.note };
    const swap: CoachSwap = { kind: "swap", replaces: original.id, item: swapItem, note: choice.note };
    await store.insertActions(deps.db, deps.userId, original.thread_id, original.message_id, [
      { id: actionId, kind: "food", payload: { custom_food: customFoodFor(choice.food), item: swap.item, meal: mealName, swap } },
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

function planOrThrow(router: AiRouter, task: AiTask, personalData: boolean) {
  try {
    router.candidates(task, { personalData });
  } catch (error) {
    throw toCoachError(error);
  }
}

/**
 * The context for a member FITX recently showed its eating-disorder note: no calorie targets, calorie
 * counts or weight numbers go to the model (the prompt also says why).
 */
function withoutCalorieNumbers(context: CoachContext): CoachContext {
  const summary: Record<string, unknown> = { ...context.summary };
  delete summary.daily_targets;
  delete summary.weight_trend;
  if (summary.member && typeof summary.member === "object") {
    const member = { ...(summary.member as Record<string, unknown>) };
    delete member.target_weight_kg;
    delete member.weight_kg;
    summary.member = member;
  }
  if (summary.nutrition && typeof summary.nutrition === "object") {
    const nutrition = summary.nutrition as Record<string, unknown>;
    summary.nutrition = { days_logged_last_7: nutrition.days_logged_last_7, most_logged_foods: nutrition.most_logged_foods };
  }
  return { facts: { ...context.facts, target: null }, summary };
}

/**
 * Filters a parsed plan through the member's diet and allergy rules. Too many breaches, or a day the
 * model planned far under the member's minimum, and the model's plan is rejected (the next model is tried).
 */
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
  const calories = meals.reduce((sum, meal) => sum + meal.items.reduce((total, item) => total + item.calories, 0), 0);
  if (calories < facts.calorieFloor * 0.6) return null;
  return { plan: { ...plan, meals }, removed };
}

function buildMealPlan(model: ModelMealPlan, grounded: Array<Array<GroundedFood | GroundingConflict>>, facts: MemberFacts, budgetNote: string | null, removed: string[]) {
  const checks: string[] = removed.map((line) => `Left out ${line}.`);
  // Dishes FITX's own food data lists with an allergen or a food the member's diet rules out.
  for (const outcome of grounded.flat()) {
    if (isConflict(outcome)) checks.push(`Left out ${outcome.name}: FITX's food data shows ${outcome.conflict.replace(/^it /, "it ")}.`);
  }
  let foods = grounded.map((meal) => meal.filter((outcome): outcome is GroundedFood => !isConflict(outcome)));
  const target = facts.target;
  const total = () => foods.flat().reduce((sum, food) => sum + food.item.calories, 0);
  const resizeTo = (goal: number, maxFactor: number) => {
    const fixed = foods.flat().filter((food) => !food.scalable).reduce((sum, food) => sum + food.item.calories, 0);
    const scalable = total() - fixed;
    if (scalable <= 0) return false;
    const factor = Math.min(maxFactor, Math.max(0.75, (goal - fixed) / scalable));
    foods = foods.map((meal) => meal.map((food) => resize(food, factor)));
    return true;
  };

  if (target && total() > 0) {
    const ratio = total() / target.calories;
    if ((ratio < 0.9 || ratio > 1.1) && resizeTo(target.calories, 1.35)) {
      checks.push(`FITX resized gram portions so the day comes closer to your target of about ${target.calories.toLocaleString("en-IN")} kcal.`);
    }
  }
  // FITX never shows a day under the member's minimum: bring gram portions up to it, or make no plan.
  if (total() < facts.calorieFloor) {
    if (resizeTo(facts.calorieFloor * 1.02, 1.6)) checks.push(`FITX raised gram portions so the day reaches at least ${facts.calorieFloor.toLocaleString("en-IN")} kcal, the least it plans for.`);
    if (total() < facts.calorieFloor) {
      throw new CoachError(
        "failed",
        `FITX couldn't make a safe day of meals: the coach's plan came to about ${total().toLocaleString("en-IN")} kcal, under the ${facts.calorieFloor.toLocaleString("en-IN")} kcal FITX plans for at least. Nothing was saved. Try again, without a calorie limit.`,
      );
    }
  }
  if (target) {
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
  if (facts.allergies.rules.length || facts.allergies.other.length) {
    checks.push(`FITX checks food names against your allergies, not full recipes. Check ingredients and labels for ${describeAllergies(facts.allergies)} before you eat.`);
  }

  const actions: store.NewAction[] = [];
  const meals: CoachMeal[] = model.meals
    .map((meal, mealIndex) => ({ meal, mealIndex, foods: foods[mealIndex] }))
    .filter((entry) => entry.foods.length)
    .map(({ meal, mealIndex, foods: mealFoods }) => {
      const items: CoachFoodItem[] = mealFoods.map((food) => {
        const id = crypto.randomUUID();
        const item: CoachFoodItem = { ...food.item, key: id, actionId: id, note: allergyNote(food, facts) ?? food.item.note };
        actions.push({ id, kind: "food", payload: { custom_food: customFoodFor(food), item, meal: meal.name } });
        return item;
      });
      const mealFood = customMealFor(meal.name, mealFoods);
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

/** For a member with allergies, a food FITX could not check against its data says so on the card. */
function allergyNote(food: GroundedFood, facts: MemberFacts): string | null {
  if (food.item.basis !== "ai_estimate" || (!facts.allergies.rules.length && !facts.allergies.other.length)) return null;
  return `Not in FITX's food data: check the ingredients for ${describeAllergies(facts.allergies)}.`;
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

/**
 * Exercises the member can do where they train, from FITX's exercise library, with the Workouts page's own
 * rules: outdoor training uses the home list, "both" the gym list, and the member's saved Home or Gym
 * equipment (or, before they save one, a starting list from their profile).
 */
async function exerciseCandidates(db: store.Db, userId: string, facts: MemberFacts): Promise<ExerciseCandidate[]> {
  const [catalog, equipment] = await Promise.all([loadCatalog(db), loadEquipmentProfiles(db, userId)]);
  if (catalog.error) return [];
  const context: TrainingContext = facts.location === "home" || facts.location === "outdoor" ? "home" : "gym";
  const owned = ownedEquipmentSet(equipment.profiles, context, facts.equipment);
  const advanced = facts.level === "advanced";
  const eligible = catalog.exercises.filter((exercise) => {
    if (exercise.category === "stretching" || (!advanced && (exercise.category === "olympic" || exercise.category === "strongman"))) return false;
    if (!exercise.locations.includes(context)) return false;
    if (!advanced && exercise.difficulty === "advanced") return false;
    return isDoableWith(exercise.required_equipment, owned);
  });
  // A different, stable order each day, so suggestions vary without changing within a day.
  const daily = (id: string) => [...`${facts.today}:${id}`].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
  const rested = (exercise: { muscle_group: string; primary_muscle: string }) => (facts.recentMuscles.includes(exercise.primary_muscle) || facts.recentMuscles.includes(exercise.muscle_group) ? 1 : 0);
  const byGroup = new Map<string, ExerciseCandidate[]>();
  for (const exercise of eligible.sort((a, b) => rested(a) - rested(b) || daily(a.id) - daily(b.id))) {
    const group = byGroup.get(exercise.muscle_group) ?? [];
    if (group.length < 6) {
      group.push({
        id: exercise.id,
        name: exercise.name,
        muscle: exercise.muscle_group,
        equipment: exercise.required_equipment.map(equipmentLabel),
        difficulty: exercise.difficulty,
        prescription: exercise.prescription_type,
      });
    }
    byGroup.set(exercise.muscle_group, group);
  }
  return [...byGroup.values()].flat().slice(0, 60);
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
    if (error.reason === "private") {
      return new CoachError(
        "plans_unavailable",
        "Coaching with your FITX data isn't switched on yet: FITX only sends your data to AI services that don't let people read it. You can still ask general questions with “Questions only” in the coach's settings.",
      );
    }
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
