// The Reports data: checks what fitx_admin_op_report returns, sums it and writes the CSV exports.
// Imports only the CSV writer. A value that is not a count makes the whole report unreadable rather
// than turning into 0; the one value that may be unknown (average workout length) stays null.
import { csvNumber, toCsv } from "../csv";

export const REPORT_RANGES = [30, 90, 180, 365] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export function parseRange(value: unknown): ReportRange {
  const n = Number(value);
  return (REPORT_RANGES as readonly number[]).includes(n) ? (n as ReportRange) : 90;
}

export const DAILY_KEYS = [
  "new_accounts", "dau", "wau", "mau", "workouts_completed", "workout_members", "sets_logged",
  "meals_logged", "meal_members", "water_entries", "activities_recorded",
] as const;
export type DailyKey = (typeof DAILY_KEYS)[number];
export type ReportDay = { day: string } & Record<DailyKey, number>;

export const MONTHLY_KEYS = ["new_accounts", "subscriptions_started", "cancellations", "payments_captured", "payments_failed", "captured_paise", "refunded_paise"] as const;
export type MonthlyKey = (typeof MONTHLY_KEYS)[number];
export type ReportMonth = { month: string } & Record<MonthlyKey, number>;

export type Report = {
  generatedAt: string;
  days: number;
  from: string;
  to: string;
  accountsTotal: number;
  accountsBefore: number;
  daily: ReportDay[];
  workouts: {
    completed: number;
    abandoned: number;
    members: number;
    avgMinutes: number | null;
    topExercises: Array<{ exerciseId: string; name: string; sessions: number; members: number }>;
    activitiesBySport: Record<string, number>;
    enrolmentsActive: number;
    enrolmentsStarted: number;
  };
  nutrition: {
    meals: number;
    members: number;
    barcodeMeals: number;
    bySource: Array<{ source: string; meals: number }>;
    bySlot: Record<string, number>;
    customFoodsCreated: number;
    savedMealsCreated: number;
    routinesCreated: number;
    waterEntries: number;
  };
  subscriptions: { byStatus: Record<string, number>; payingNow: number };
  monthly: ReportMonth[];
};

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function count(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d{1,15}$/.test(value)) return Number(value);
  return null;
}

class Unreadable extends Error {}
function must(value: unknown): number {
  const n = count(value);
  if (n === null) throw new Unreadable();
  return n;
}
function counts(value: unknown): Record<string, number> {
  if (!isRecord(value)) throw new Unreadable();
  return Object.fromEntries(Object.entries(value).map(([key, n]) => [key, must(n)]));
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseReport(data: unknown): Report | null {
  try {
    if (!isRecord(data) || !Array.isArray(data.daily) || !Array.isArray(data.monthly) || !isRecord(data.workouts) || !isRecord(data.nutrition) || !isRecord(data.subscriptions)) {
      return null;
    }
    const daily = data.daily.map((row): ReportDay => {
      if (!isRecord(row) || typeof row.day !== "string" || !DAY.test(row.day)) throw new Unreadable();
      return { day: row.day, ...(Object.fromEntries(DAILY_KEYS.map((key) => [key, must(row[key])])) as Record<DailyKey, number>) };
    });
    const monthly = data.monthly.map((row): ReportMonth => {
      if (!isRecord(row) || typeof row.month !== "string" || !/^\d{4}-\d{2}$/.test(row.month)) throw new Unreadable();
      return { month: row.month, ...(Object.fromEntries(MONTHLY_KEYS.map((key) => [key, must(row[key])])) as Record<MonthlyKey, number>) };
    });
    const w = data.workouts;
    const n = data.nutrition;
    const avg = w.avg_minutes === null || w.avg_minutes === undefined ? null : Number(w.avg_minutes);
    if (avg !== null && (!Number.isFinite(avg) || avg < 0)) throw new Unreadable();
    const top = Array.isArray(w.top_exercises) ? w.top_exercises : [];
    const sources = Array.isArray(n.by_source) ? n.by_source : [];
    return {
      generatedAt: typeof data.generated_at === "string" ? data.generated_at : "",
      days: must(data.days),
      from: typeof data.from === "string" ? data.from : "",
      to: typeof data.to === "string" ? data.to : "",
      accountsTotal: must(data.accounts_total),
      accountsBefore: must(data.accounts_before),
      daily,
      workouts: {
        completed: must(w.completed),
        abandoned: must(w.abandoned),
        members: must(w.members),
        avgMinutes: avg,
        topExercises: top.map((row) => {
          if (!isRecord(row) || typeof row.exercise_id !== "string" || typeof row.name !== "string") throw new Unreadable();
          return { exerciseId: row.exercise_id, name: row.name, sessions: must(row.sessions), members: must(row.members) };
        }),
        activitiesBySport: counts(w.activities_by_sport ?? {}),
        enrolmentsActive: must(w.programme_enrolments_active),
        enrolmentsStarted: must(w.programme_enrolments_started),
      },
      nutrition: {
        meals: must(n.meals),
        members: must(n.members),
        barcodeMeals: must(n.barcode_meals),
        bySource: sources.map((row) => {
          if (!isRecord(row) || typeof row.source !== "string") throw new Unreadable();
          return { source: row.source, meals: must(row.meals) };
        }),
        bySlot: counts(n.by_slot ?? {}),
        customFoodsCreated: must(n.custom_foods_created),
        savedMealsCreated: must(n.saved_meals_created),
        routinesCreated: must(n.routines_created),
        waterEntries: must(n.water_entries),
      },
      subscriptions: { byStatus: counts(data.subscriptions.by_status ?? {}), payingNow: must(data.subscriptions.paying_now) },
      monthly,
    };
  } catch (error) {
    if (error instanceof Unreadable) return null;
    throw error;
  }
}

// Summaries --------------------------------------------------------------------------------------

export function total(days: readonly ReportDay[], key: DailyKey): number {
  return days.reduce((sum, day) => sum + day[key], 0);
}

/** The last day's value (today, IST), or null for an empty range. */
export function latest(days: readonly ReportDay[], key: DailyKey): number | null {
  return days.length ? days[days.length - 1][key] : null;
}

/** Accounts at the end of each day: those made before the range plus the running sum of new ones. */
export function cumulativeAccounts(report: Pick<Report, "accountsBefore" | "daily">): number[] {
  let running = report.accountsBefore;
  return report.daily.map((day) => (running += day.new_accounts));
}

/** Change from the first to the last value as a whole percentage, or null when it starts at 0. */
export function percentChange(first: number, last: number): number | null {
  if (first === 0) return null;
  return Math.round(((last - first) / first) * 100);
}

/**
 * DAU / MAU on the last day ("stickiness"): the share (0 to 1) of the last 30 days' active members who were active that
 * day, or null without monthly actives. Shown with percent()'s rule, so 199 of 200 never reads as all of them.
 */
export function stickiness(days: readonly ReportDay[]): number | null {
  const last = days[days.length - 1];
  if (!last || last.mau === 0) return null;
  return last.dau / last.mau;
}

/** Days grouped into Monday-start weeks, summing a flow measure. */
export function weekly(days: readonly ReportDay[], key: DailyKey): Array<{ week: string; value: number }> {
  const weeks = new Map<string, number>();
  for (const day of days) {
    const date = new Date(`${day.day}T00:00:00Z`);
    const monday = new Date(date.valueOf() - ((date.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    weeks.set(monday, (weeks.get(monday) ?? 0) + day[key]);
  }
  return [...weeks].map(([week, value]) => ({ week, value }));
}

// CSV ---------------------------------------------------------------------------------------------

export const EXPORTS = {
  daily: "Daily activity",
  monthly: "Monthly growth and revenue",
  nutrition: "Nutrition use",
  exercises: "Top exercises",
} as const;
export type ExportKind = keyof typeof EXPORTS;

export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === "string" && Object.hasOwn(EXPORTS, value);
}

const DAILY_HEADERS: Record<DailyKey, string> = {
  new_accounts: "New accounts",
  dau: "Daily active",
  wau: "Weekly active (7 days)",
  mau: "Monthly active (30 days)",
  workouts_completed: "Workouts completed",
  workout_members: "Members who completed a workout",
  sets_logged: "Sets logged",
  meals_logged: "Meals logged",
  meal_members: "Members who logged a meal",
  water_entries: "Water entries",
  activities_recorded: "Walks, runs and rides recorded",
};

/** Rupees with two decimals, kept a number in the CSV (a negative net month must still add up). */
const rupees = (paise: number) => csvNumber(paise / 100, 2);

export function reportCsv(report: Report, kind: ExportKind): string {
  if (kind === "daily") {
    const totals = cumulativeAccounts(report);
    return toCsv(
      ["Day (IST)", "Accounts at end of day", ...DAILY_KEYS.map((key) => DAILY_HEADERS[key])],
      report.daily.map((day, index) => [day.day, totals[index], ...DAILY_KEYS.map((key) => day[key])]),
    );
  }
  if (kind === "monthly") {
    return toCsv(
      ["Month (IST)", "New accounts", "Subscriptions started (live)", "Cancellations (live)", "Payments captured (live)", "Payments failed (live)", "Captured INR (live)", "Refunded INR (live)", "Net INR (live)"],
      report.monthly.map((month) => [
        month.month, month.new_accounts, month.subscriptions_started, month.cancellations, month.payments_captured, month.payments_failed,
        rupees(month.captured_paise), rupees(month.refunded_paise), rupees(month.captured_paise - month.refunded_paise),
      ]),
    );
  }
  if (kind === "nutrition") {
    const n = report.nutrition;
    return toCsv(["Measure", "Value", "Range (IST)"], [
      ["Meals logged", n.meals, `${report.from} to ${report.to}`],
      ["Members who logged a meal", n.members, `${report.from} to ${report.to}`],
      ["Meals with a scanned barcode", n.barcodeMeals, `${report.from} to ${report.to}`],
      ["Custom foods created", n.customFoodsCreated, `${report.from} to ${report.to}`],
      ["Saved meals created", n.savedMealsCreated, `${report.from} to ${report.to}`],
      ["Day routines created", n.routinesCreated, `${report.from} to ${report.to}`],
      ["Water entries", n.waterEntries, `${report.from} to ${report.to}`],
      ...Object.entries(n.bySlot).map(([slot, value]) => [`Meals at ${slot}`, value, `${report.from} to ${report.to}`]),
      ...n.bySource.map((row) => [`Meals from source: ${row.source}`, row.meals, `${report.from} to ${report.to}`]),
    ]);
  }
  return toCsv(
    ["Exercise", "Exercise id", "Completed workouts with it", "Members"],
    report.workouts.topExercises.map((row) => [row.name, row.exerciseId, row.sessions, row.members]),
  );
}
