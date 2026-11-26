/**
 * Which day's figures Nutrition may show. Until the day asked for has loaded, nothing about it is known, so the page
 * shows a loading (or failed) state: never "0 kcal eaten", "no target" or another day's figures under this day's date.
 * Pure, so `node --test` can check it.
 */
import { calorieBalance, goalPercent, goalProgress, knownMacro, MACRO_KEYS, MACRO_LABEL, type DayTargets, type KnownTotals, type MacroKey } from "@/lib/domain/nutrition";

export type DayLoad = "loading" | "ready" | "failed";

/**
 * `shownKey`: the day whose meals, water and targets the page holds (null before the first load); `failedKey`: the
 * day whose last load failed. The day asked for is ready only once its own data is in.
 */
export function dayLoadState(shownKey: string | null, failedKey: string | null, wantedKey: string): DayLoad {
  if (shownKey === wantedKey) return "ready";
  if (failedKey === wantedKey) return "failed";
  return "loading";
}

/** The overview's line while the day's figures are not there. */
export function dayStatusText(state: Exclude<DayLoad, "ready">): string {
  return state === "loading" ? "Loading this day…" : "This day couldn't be loaded.";
}

/**
 * The meal list's line while the day's meals are not there. A failed day's message, with its Try again (or Sign in),
 * is the page's, under the tabs, for as long as the day stays failed: this line never sends the member to reload.
 */
export function mealsStatusText(state: Exclude<DayLoad, "ready">): string {
  return state === "loading" ? "Loading meals…" : "This day's meals couldn't be loaded.";
}

/** The line under a ring: how much is left (or over), or a note (no target yet, or the day's status). */
export type OverviewLine = { kind: "amount"; amount: string; text: string; over: boolean } | { kind: "note"; text: string };

/** What the day's overview shows, in one shape for every state, so its buttons are the same elements before and after. */
export interface OverviewView {
  /** aria-busy: the day is loading. */
  busy: boolean;
  /** "Loading this day…" or "This day couldn't be loaded." until the day is in, else null. */
  status: string | null;
  /** The targets button: "Targets" doing nothing until the day is in, then "Your targets" or "Edit targets". */
  targets: { label: string; acts: boolean };
  /** Where the targets come from, under the heading. */
  source: string | null;
  energy: { label: string; percent: number; over: boolean; number: string; unit: string; line: OverviewLine };
  protein: { label: string; percent: number; number: string; grams: boolean; unit: string; line: OverviewLine | null };
  macros: Array<{ key: "carbs" | "fat"; name: string; value: string; goal: string; progress: { percent: number; over: boolean; label: string } | null }>;
  /** The fine print: estimates included, and entries left out for lack of a value. */
  fine: string | null;
  /** Water: the amount and target, its progress, the goal link when there is no target, and whether + adds water. */
  water: { amount: string; target: string | null; percent: number | null; goalLink: boolean; acts: boolean };
}

export interface OverviewInput {
  state: DayLoad;
  totals: KnownTotals;
  target: DayTargets | null;
  targetSource: string;
  hasOwnTargets: boolean;
  estimateCount: number;
  water: { ml: number; target: number | null };
}

const SMALL_MACROS = [["carbs", "Carbs"], ["fat", "Fat"]] as const;

/**
 * Why a day's total of a macro is unknown: food is logged, but none of it gives that value (the day's only food, or all
 * of them), so the overview shows no number, percent or "left" for it, as meal-totals' unknownDayTotal rule says.
 */
export function noValueText(entries: number, key: MacroKey): string {
  return entries === 1 ? `the food logged has no ${MACRO_LABEL[key]} value` : `none of the foods logged has a ${MACRO_LABEL[key]} value`;
}

/**
 * The overview's words and figures. Until the day asked for is in (loading, or failed), every figure is a dash, there
 * is no "no target", and neither the targets nor the water buttons act: never 0 kcal or another day's figures.
 */
export function overviewView(input: OverviewInput): OverviewView {
  const { state, totals, target, targetSource, hasOwnTargets, estimateCount, water } = input;
  if (state !== "ready") {
    const status = dayStatusText(state);
    return {
      busy: state === "loading",
      status,
      targets: { label: "Targets", acts: false },
      source: null,
      energy: { label: `Calories: ${status}`, percent: 0, over: false, number: "–", unit: "kcal", line: { kind: "note", text: status } },
      protein: { label: `Protein: ${status}`, percent: 0, number: "–", grams: false, unit: "protein", line: null },
      macros: SMALL_MACROS.map(([key, name]) => ({ key, name, value: "–", goal: "", progress: null })),
      fine: null,
      water: { amount: "–", target: null, percent: null, goalLink: false, acts: false },
    };
  }
  const eaten = Math.round(totals.calories);
  const goal = target?.calories ?? null;
  const progress = goal ? goalProgress(totals.calories, goal) : null;
  const balance = calorieBalance(totals.calories, goal);
  const protein = Math.round(totals.protein);
  const proteinGoal = target?.protein ?? null;
  const proteinProgress = proteinGoal ? goalProgress(totals.protein, proteinGoal) : null;
  const proteinLeft = proteinGoal ? Math.round(proteinGoal) - protein : null;
  const unknown = MACRO_KEYS.filter((key) => totals.unknown[key] > 0);
  // No food logged gives protein: unknown, never "0 g" with "120 g protein left".
  const proteinUnknown = knownMacro(totals, "protein") === null;
  return {
    busy: false,
    status: null,
    targets: { label: hasOwnTargets ? "Your targets" : "Edit targets", acts: true },
    source: target ? targetSource : null,
    energy: {
      label: `${eaten} calories logged${goal ? ` of ${goal} calorie target` : ""}${balance ? `, ${balance.remaining} ${balance.over ? "over" : "left"}` : ""}`,
      percent: progress?.percent ?? 0,
      over: progress?.isOver ?? false,
      number: eaten.toLocaleString("en-GB"),
      unit: goal ? `/ ${goal.toLocaleString("en-GB")} kcal` : "kcal eaten",
      line: balance
        ? { kind: "amount", amount: balance.remaining.toLocaleString("en-GB"), text: `kcal ${balance.over ? "over your target" : "left"}`, over: balance.over }
        : { kind: "note", text: "Set a target to see what's left." },
    },
    protein: proteinUnknown
      ? {
        label: `Protein unknown: ${noValueText(totals.entries, "protein")}${proteinGoal ? `. Target ${proteinGoal} grams` : ""}`,
        percent: 0,
        number: "–",
        grams: false,
        unit: proteinGoal ? `/ ${proteinGoal} g protein` : "protein",
        line: { kind: "note", text: `Unknown: ${noValueText(totals.entries, "protein")}.` },
      }
      : {
        label: `${protein} grams of protein logged${proteinGoal ? ` of ${proteinGoal} gram target` : ""}${totals.unknown.protein ? `, ${totals.unknown.protein} without protein` : ""}`,
        percent: proteinProgress?.percent ?? 0,
        number: String(protein),
        grams: true,
        unit: proteinGoal ? `/ ${proteinGoal} g protein` : "protein",
        line: proteinLeft !== null
          ? { kind: "amount", amount: String(Math.abs(proteinLeft)), text: `g protein ${proteinLeft < 0 ? "over" : "left"}`, over: false }
          : { kind: "note", text: "No protein target yet." },
      },
    macros: SMALL_MACROS.map(([key, name]) => {
      const macroGoal = target?.[key] ?? null;
      // No food logged gives it: "unknown", with no bar against the target.
      if (knownMacro(totals, key) === null) return { key, name, value: "unknown", goal: macroGoal ? ` / ${macroGoal} g` : "", progress: null };
      const macro = macroGoal ? goalProgress(totals[key], macroGoal) : null;
      return {
        key, name,
        value: String(Math.round(totals[key])),
        goal: macroGoal ? ` / ${macroGoal} g` : " g",
        progress: macro ? { percent: macro.percent, over: macro.isOver, label: `${name} against target` } : null,
      };
    }),
    fine: estimateCount > 0 || unknown.length > 0
      ? `${estimateCount > 0 ? `Includes ${estimateCount} ${estimateCount === 1 ? "estimate" : "estimates"}. ` : ""}${unknown.map((key) => `${totals.unknown[key]} without ${MACRO_LABEL[key]}`).join(", ")}`
      : null,
    water: {
      amount: `${(water.ml / 1000).toFixed(1)} L`,
      target: water.target ? ` / ${(water.target / 1000).toFixed(1)} L` : null,
      percent: water.target ? goalPercent(water.ml, water.target) : null,
      goalLink: !water.target,
      acts: true,
    },
  };
}
