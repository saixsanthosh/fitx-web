/**
 * Paging and labels for the "Your plans" list.
 *
 * Plans stay in the list after they are done, so old dated plans pile up. The
 * list is therefore read in three segments, in this order, each with its own sort:
 *
 *   1. upcoming: planned for today or later, soonest first;
 *   2. undated: saved without a date, newest first;
 *   3. past: planned for an earlier day, most recent first.
 *
 * A page takes rows from the first segment that still has rows, then from the
 * next, so a plan for today is never pushed out of the first page by older plans.
 *
 * No imports, so `node --test` can load this file directly.
 */

export type PlanSegment = "upcoming" | "undated" | "past";
export const PLAN_SEGMENTS: readonly PlanSegment[] = ["upcoming", "undated", "past"];

export type PlanSegmentSpec = {
  filter: { op: "gte" | "lt"; value: string } | { op: "is"; value: null };
  order: ReadonlyArray<{ column: "planned_for" | "created_at" | "id"; ascending: boolean }>;
};

/** The `planned_for` filter and the sort for one segment; `id` keeps paging stable on ties. */
export function planSegmentSpec(segment: PlanSegment, todayKey: string): PlanSegmentSpec {
  if (segment === "upcoming") {
    return { filter: { op: "gte", value: todayKey }, order: [{ column: "planned_for", ascending: true }, { column: "created_at", ascending: true }, { column: "id", ascending: true }] };
  }
  if (segment === "undated") {
    return { filter: { op: "is", value: null }, order: [{ column: "created_at", ascending: false }, { column: "id", ascending: true }] };
  }
  return { filter: { op: "lt", value: todayKey }, order: [{ column: "planned_for", ascending: false }, { column: "created_at", ascending: false }, { column: "id", ascending: true }] };
}

/** Where the next page starts: a segment and the offset inside it. */
export type PlanPageCursor = { segment: PlanSegment; offset: number };
export const FIRST_PLAN_PAGE: PlanPageCursor = { segment: "upcoming", offset: 0 };

/** An inclusive row range in one segment, as PostgREST's `range(from, to)` takes it. */
export type PlanSegmentRequest = { segment: PlanSegment; from: number; to: number };

/**
 * The requests for one page: the cursor's segment from its offset, then each
 * later segment from its start. Each asks for one row more than a page, so the
 * page can tell whether that segment has rows left. They can run in parallel.
 */
export function planPageRequests(cursor: PlanPageCursor, pageSize: number): PlanSegmentRequest[] {
  const first = Math.max(0, PLAN_SEGMENTS.indexOf(cursor.segment));
  return PLAN_SEGMENTS.slice(first).map((segment, index) => {
    const from = index === 0 ? Math.max(0, cursor.offset) : 0;
    return { segment, from, to: from + pageSize };
  });
}

/**
 * Builds a page from the responses to `planPageRequests`, in the same order.
 * `next` is where the following page starts, or null when every segment is used up.
 */
export function composePlanPage<T>(
  responses: ReadonlyArray<{ segment: PlanSegment; from: number; rows: readonly T[] }>,
  pageSize: number,
): { rows: T[]; next: PlanPageCursor | null } {
  const rows: T[] = [];
  for (const response of responses) {
    const room = pageSize - rows.length;
    if (response.rows.length > room) {
      rows.push(...response.rows.slice(0, room));
      return { rows, next: { segment: response.segment, offset: response.from + room } };
    }
    // Fewer rows than were asked for (a page plus one): this segment has no more.
    rows.push(...response.rows);
  }
  return { rows, next: null };
}

/** `existing` followed by the rows of `incoming` that are not listed yet. */
export function mergePlansById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(existing.map((plan) => plan.id));
  const merged = [...existing];
  for (const plan of incoming) {
    if (seen.has(plan.id)) continue;
    seen.add(plan.id);
    merged.push(plan);
  }
  return merged;
}

export type PlanCardStatus = "Scheduled" | "Done" | "Past date" | "Draft";

/**
 * The status shown on a plan card. Dates are local keys (YYYY-MM-DD).
 * `lastDoneKey` is the day of the plan's latest finished session, when known.
 * A plan dated today or earlier that has been finished on or after its date is
 * "Done"; a later date is "Scheduled" even if the plan was done early.
 */
export function planCardStatus(plannedFor: string | null, todayKey: string, lastDoneKey: string | null | undefined): PlanCardStatus {
  if (!plannedFor) return "Draft";
  if (plannedFor > todayKey) return "Scheduled";
  if (lastDoneKey && lastDoneKey >= plannedFor) return "Done";
  return plannedFor === todayKey ? "Scheduled" : "Past date";
}
