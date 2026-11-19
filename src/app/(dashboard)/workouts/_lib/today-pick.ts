/**
 * The workout the Workouts page leads with: today's planned workout that is not done yet (a programme day before
 * the member's own plans), else the next one coming up, else nothing. Dates are local keys (YYYY-MM-DD). Pure.
 */
export type TodayCandidate = {
  id: string;
  title: string;
  planned_for: string | null;
  /** Local day of the plan's latest finished session, or null when none is known. */
  last_done_key: string | null;
  /** The programme day's position in its cycle; null for the member's own plans. */
  programme_day_index?: number | null;
};

export type TodayPick =
  | { kind: "today"; plan: TodayCandidate; programme: boolean }
  | { kind: "next"; plan: TodayCandidate; programme: boolean }
  | { kind: "none" };

/** A programme day counts once: any finished session makes it done. An own plan is done when finished on or after its date. */
function isDone(plan: TodayCandidate, programme: boolean): boolean {
  if (!plan.last_done_key) return false;
  if (programme) return true;
  return Boolean(plan.planned_for && plan.last_done_key >= plan.planned_for);
}

export function pickToday(todayKey: string, programmePlans: readonly TodayCandidate[], ownPlans: readonly TodayCandidate[]): TodayPick {
  const candidates = [
    ...programmePlans.map((plan) => ({ plan, programme: true })),
    ...ownPlans.map((plan) => ({ plan, programme: false })),
  ].filter(({ plan, programme }) => plan.planned_for && plan.planned_for >= todayKey && !isDone(plan, programme));
  const today = candidates.find(({ plan }) => plan.planned_for === todayKey);
  if (today) return { kind: "today", ...today };
  // The soonest later date; on a tie the programme day comes first (it is listed first and the sort is stable).
  const next = [...candidates].sort((a, b) => (a.plan.planned_for! < b.plan.planned_for! ? -1 : a.plan.planned_for! > b.plan.planned_for! ? 1 : 0))[0];
  return next ? { kind: "next", ...next } : { kind: "none" };
}

