/**
 * The Today card's main button when a workout may be in progress (bug 30). Its own plan's workout in progress:
 * "Continue workout". Another workout in progress: "Continue current workout", with a line naming that workout and
 * saying it is finished first (as the plan preview says), never a "Continue workout" that opens something else.
 * Pure.
 */
export type ActiveWorkout = { id: string; name: string; planId: string | null };

export type TodayStart =
  | { kind: "start"; label: "Start workout"; note: null }
  | { kind: "continue"; label: "Continue workout"; note: null }
  | { kind: "other"; label: "Continue current workout"; note: string };

export function todayStart(plan: { id: string; title: string }, active: ActiveWorkout | null): TodayStart {
  if (!active) return { kind: "start", label: "Start workout", note: null };
  if (active.planId === plan.id) return { kind: "continue", label: "Continue workout", note: null };
  return { kind: "other", label: "Continue current workout", note: `You have a workout in progress (${active.name}). Finish it before you start ${plan.title}.` };
}
