/**
 * The coach composer's decisions, kept free of React and imports so `node --test` can run them (the test runner has
 * no DOM): which modes it offers, and which mode a starter picks.
 */

export type ComposerMode = "chat" | "meal_plan" | "workout_plan";

/** The order of the "What do you want?" choices. */
export const COMPOSER_MODES: readonly ComposerMode[] = ["chat", "meal_plan", "workout_plan"];

/**
 * How each mode is offered: "on" (can be chosen), "off" (shown but unavailable; the composer's note says why) or
 * "hidden". Plans need "Use my FITX data" and an adult profile (plansAllowed). For 30 days after FITX's
 * eating-disorder note (mealPlansPaused) the coach makes no meal plans, so "Plan my meals" is not offered at all.
 */
export function composerModes(options: { plansAllowed: boolean; mealPlansPaused: boolean }): Record<ComposerMode, "on" | "off" | "hidden"> {
  return {
    chat: "on",
    meal_plan: options.mealPlansPaused ? "hidden" : options.plansAllowed ? "on" : "off",
    workout_plan: options.plansAllowed ? "on" : "off",
  };
}

/** The mode a starter or suggestion puts the composer in: its own when that mode can be chosen now, else Ask. */
export function modeFor(wanted: ComposerMode, options: { plansAllowed: boolean; mealPlansPaused: boolean }): ComposerMode {
  return composerModes(options)[wanted] === "on" ? wanted : "chat";
}
