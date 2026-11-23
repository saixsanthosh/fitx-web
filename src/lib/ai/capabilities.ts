/**
 * What FITX Coach does, as the coach page and panel offer it: one short starter per job. A starter only fills the
 * message box (or picks a plan mode); the member still presses Send. Voice conversation is the microphone button,
 * so it has no starter. Plans need "Use my FITX data" (and an adult profile), so their starters are left out
 * otherwise, never shown as dead buttons. With data sharing off, the wording asks in general terms, because the
 * coach then has no logs to read.
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
};

export const COACH_CAPABILITIES: readonly Capability[] = [
  { id: "workout_plan", label: "Plan a workout", mode: "workout_plan", personal: "Plan a workout for today.", general: null, needsData: true },
  { id: "meal_plan", label: "Plan my meals", mode: "meal_plan", personal: "Plan my meals for today.", general: null, needsData: true },
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
  },
];

/** The starters to show: personal wording when the member shares their data (adults only), general wording otherwise. */
export function capabilityStarters(options: { sharesData: boolean }): Array<{ id: CapabilityId; label: string; mode: Capability["mode"]; text: string }> {
  return COACH_CAPABILITIES.flatMap((capability) => {
    if (capability.needsData && !options.sharesData) return [];
    const text = options.sharesData ? capability.personal : capability.general;
    return text ? [{ id: capability.id, label: capability.label, mode: capability.mode, text }] : [];
  });
}
