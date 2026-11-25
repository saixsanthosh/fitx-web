/**
 * The coach composer's decisions, kept free of React and imports so `node --test` can run them (the test runner has
 * no DOM): which modes it offers, which mode a starter picks, how the arrow keys move in its radio group, and what it
 * says about the message's length.
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

/**
 * The mode an arrow key, Home or End moves to in the "What do you want?" radio group: the next or previous mode that
 * can be chosen, wrapping round, as in any radio group (arrows move and select; the group is one Tab stop). null for
 * any other key, or when no mode can be chosen.
 */
export function nextMode(current: ComposerMode, key: string, choosable: readonly ComposerMode[]): ComposerMode | null {
  if (!choosable.length) return null;
  const index = choosable.indexOf(current);
  const last = choosable.length - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return choosable[index < 0 ? 0 : index === last ? 0 : index + 1];
    case "ArrowLeft":
    case "ArrowUp":
      return choosable[index <= 0 ? last : index - 1];
    case "Home":
      return choosable[0];
    case "End":
      return choosable[last];
    default:
      return null;
  }
}

/** The radio group's one Tab stop: the chosen mode, or the first that can be chosen when the chosen one can't. */
export function radioTabStop(current: ComposerMode, choosable: readonly ComposerMode[]): ComposerMode | null {
  return choosable.includes(current) ? current : choosable[0] ?? null;
}

/** The message box's limit, as the coach's route checks it (coach.ts MESSAGE_MAX). */
export const MESSAGE_MAX = 2000;

/**
 * What the message box says about its length. The counter shows from 200 characters before the limit (red past it)
 * and only then is part of the box's description. Screen readers hear about the length only when it comes near or
 * goes over the limit: `live` changes only at those two points, never on each key press.
 */
export function lengthNotice(length: number, max = MESSAGE_MAX): { shown: boolean; over: boolean; live: string } {
  const limit = max.toLocaleString("en-IN");
  if (length > max) return { shown: true, over: true, live: `Over the ${limit}-character limit. Shorten your message to send it.` };
  if (length > max - 200) return { shown: true, over: false, live: `Close to the ${limit}-character limit.` };
  return { shown: false, over: false, live: "" };
}
