/**
 * What FITX Coach does, as the coach page and panel offer it: one short starter per job. A starter only fills the
 * message box (or picks a plan mode); the member still presses Send. Voice conversation is the microphone button,
 * so it has no starter. Plans need "Use my FITX data" (and an adult profile), so their starters are left out
 * otherwise, never shown as dead buttons. With data sharing off, the wording asks in general terms, because the
 * coach then has no logs to read.
 *
 * For 30 days after FITX's eating-disorder note (careMode, status.ts) the coach makes no meal plans or swaps and gives
 * no calorie targets (coach.ts planBlock), so nothing here offers them or asks about food, calories or weight then,
 * as the quick prompts do (quick-prompts.ts).
 */

export type CapabilityId = "workout_plan" | "meal_plan" | "exercise_help" | "progress" | "motivation" | "recovery" | "adjust";

export type Capability = {
  id: CapabilityId;
  /** The chip's label: two or three words. */
  label: string;
  mode: "chat" | "meal_plan" | "workout_plan";
  /** Text for a member who shares their data; the coach reads their logs. */
  personal: string;
  /** Text for a member who doesn't (or can't); null leaves the starter out. */
  general: string | null;
  /** True when the starter needs the member's data ("Use my FITX data" on and an adult profile), as plans do. */
  needsData: boolean;
  /** Text for the 30 days after FITX's eating-disorder note, when the usual text is about food or targets; null leaves the starter out. */
  care?: { personal: string | null; general: string | null };
};

export const COACH_CAPABILITIES: readonly Capability[] = [
  { id: "workout_plan", label: "Plan a workout", mode: "workout_plan", personal: "Plan a workout for today.", general: null, needsData: true },
  { id: "meal_plan", label: "Plan my meals", mode: "meal_plan", personal: "Plan my meals for today.", general: null, needsData: true, care: { personal: null, general: null } },
  {
    id: "exercise_help", label: "Exercise help", mode: "chat",
    personal: "Explain how to do a Romanian deadlift, with an alternative for my equipment and the sets and reps for my goal.",
    general: "Explain how to do a Romanian deadlift, with an easier alternative and good sets and reps for a beginner.",
    needsData: false,
  },
  {
    id: "progress", label: "Analyse my progress", mode: "chat",
    personal: "Look at my last 4 weeks of training, activities and food. What patterns do you see, and what one change would help most?",
    general: null,
    needsData: true,
    care: { personal: "Look at my last 4 weeks of training and activities. What patterns do you see, and what one change would help most?", general: null },
  },
  {
    id: "motivation", label: "Daily boost", mode: "chat",
    personal: "Give me a short boost for today, based on what I've actually done this week.",
    general: "I'm struggling to get going today. Give me one small, realistic step.",
    needsData: false,
  },
  {
    id: "recovery", label: "Recovery check", mode: "chat",
    personal: "Am I recovering enough? Look at my training this week and tell me if I need a rest or lighter day.",
    general: "How much rest and sleep do I need between workouts, and when should I see a professional about soreness or pain?",
    needsData: false,
  },
  {
    id: "adjust", label: "Get back on track", mode: "chat",
    personal: "I've missed some workouts or targets lately. Suggest realistic adjustments for this week.",
    general: "I keep missing workouts. How can I make my routine more realistic?",
    needsData: false,
    care: { personal: "I've missed some workouts lately. Suggest realistic adjustments for this week.", general: "I keep missing workouts. How can I make my routine more realistic?" },
  },
];

/**
 * The starters to show: personal wording when the member shares their data (adults only), general wording otherwise.
 * `careMode`: the 30 days after FITX's eating-disorder note: no meal plans, and nothing about food or targets.
 */
export function capabilityStarters(options: { sharesData: boolean; careMode?: boolean }): Array<{ id: CapabilityId; label: string; mode: Capability["mode"]; text: string }> {
  return COACH_CAPABILITIES.flatMap((capability) => {
    if (capability.needsData && !options.sharesData) return [];
    const wording = options.careMode && capability.care ? capability.care : capability;
    const text = options.sharesData ? wording.personal : wording.general;
    return text ? [{ id: capability.id, label: capability.label, mode: capability.mode, text }] : [];
  });
}

export type GeneralPrompt = { source: "food" | "training" | "general"; context: string; text: string };

/** Suggested questions for a member whose own data the coach doesn't read ("Questions only", or no prompts yet). */
export const GENERAL_PROMPTS: readonly GeneralPrompt[] = [
  { source: "food", context: "Protein", text: "How much protein do I need a day?" },
  { source: "food", context: "Budget", text: "How do I eat well on a tight budget?" },
  { source: "training", context: "Training", text: "What's a good beginner training split?" },
  { source: "training", context: "Warm-up", text: "How do I warm up before lifting?" },
];

/** The same for under-18 accounts. */
export const MINOR_PROMPTS: readonly GeneralPrompt[] = [
  { source: "food", context: "Food", text: "What should I eat before sports practice?" },
  { source: "training", context: "Strength", text: "How can I get stronger safely?" },
  { source: "general", context: "Recovery", text: "How much sleep do I need?" },
];

/** The general suggestions to show; in the 30 days after FITX's eating-disorder note, none about food. */
export function generalPrompts(options: { minor: boolean; careMode?: boolean }): GeneralPrompt[] {
  const list = options.minor ? MINOR_PROMPTS : GENERAL_PROMPTS;
  return list.filter((prompt) => !(options.careMode && prompt.source === "food"));
}
