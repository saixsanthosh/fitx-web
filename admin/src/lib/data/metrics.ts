import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { logServerError } from "@/lib/log";
import { isMissingFunction } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

const METRIC_KEYS = [
  "accounts",
  "confirmed_accounts",
  "new_accounts_7d",
  "new_accounts_30d",
  "signed_in_24h",
  "signed_in_7d",
  "signed_in_30d",
  "active_24h",
  "active_7d",
  "active_30d",
  "workouts_completed_7d",
  "workouts_completed_30d",
  "meals_logged_7d",
  "meals_logged_30d",
  "published_exercises",
  "admin_team_accounts",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];
export type PlatformMetrics = Record<MetricKey, number> & { generated_at: string | null };

const LEGACY_KEYS = ["registered_users", "active_users_30d", "completed_workouts_30d", "active_exercises", "food_logs_30d"] as const;
export type LegacyMetrics = Record<(typeof LEGACY_KEYS)[number], number>;

export type MetricsResult =
  | { state: "ready"; metrics: PlatformMetrics }
  /** Migration 20261118180003 is not applied yet: the original five counts, with their old meanings. */
  | { state: "legacy"; metrics: LegacyMetrics }
  | { state: "service_key_missing" | "migration_pending" | "query_failed" };

export type TrendDay = { day: string; new_accounts: number; active_accounts: number; workouts_completed: number; meals_logged: number };
export type TrendsResult = { state: "ready"; days: TrendDay[] } | { state: "service_key_missing" | "migration_pending" | "query_failed" };

function count(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function readCounts<K extends string>(source: Record<string, unknown> | null, keys: readonly K[]): Record<K, number> | null {
  const result = {} as Record<K, number>;
  for (const key of keys) {
    const value = count(source?.[key]);
    if (value === null) return null;
    result[key] = value;
  }
  return result;
}

export async function getPlatformMetrics(): Promise<MetricsResult> {
  await requireAdmin("overview.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const { data, error } = await admin.rpc("fitx_admin_metrics");
  if (!error) {
    const source = data as Record<string, unknown> | null;
    const counts = readCounts(source, METRIC_KEYS);
    if (!counts) {
      logServerError("data.metrics", { message: "the metrics function returned a value that is not a count" });
      return { state: "query_failed" };
    }
    return { state: "ready", metrics: { ...counts, generated_at: typeof source?.generated_at === "string" ? source.generated_at : null } };
  }
  if (!isMissingFunction(error)) {
    logServerError("data.metrics", error);
    return { state: "query_failed" };
  }

  const legacy = await admin.rpc("fitx_admin_overview_metrics");
  if (legacy.error) {
    if (isMissingFunction(legacy.error)) return { state: "migration_pending" };
    logServerError("data.metrics_legacy", legacy.error);
    return { state: "query_failed" };
  }
  const counts = readCounts(legacy.data as Record<string, unknown> | null, LEGACY_KEYS);
  return counts ? { state: "legacy", metrics: counts } : { state: "query_failed" };
}

export async function getDailyTrends(days: number): Promise<TrendsResult> {
  await requireAdmin("reports.view");
  return readDailyTrends(days);
}

/** The same daily counts for the Dashboard, which every role with overview.view opens. */
export async function getOverviewTrends(days: number): Promise<TrendsResult> {
  await requireAdmin("overview.view");
  return readDailyTrends(days);
}

async function readDailyTrends(days: number): Promise<TrendsResult> {
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const { data, error } = await admin.rpc("fitx_admin_daily_trends", { p_days: days });
  if (error) {
    if (isMissingFunction(error)) return { state: "migration_pending" };
    logServerError("data.trends", error);
    return { state: "query_failed" };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const parsed: TrendDay[] = [];
  for (const row of rows) {
    const counts = readCounts(row, ["new_accounts", "active_accounts", "workouts_completed", "meals_logged"] as const);
    if (!counts || typeof row.day !== "string") {
      logServerError("data.trends", { message: "a trend row was not a day with counts" });
      return { state: "query_failed" };
    }
    parsed.push({ day: row.day, ...counts });
  }
  return { state: "ready", days: parsed };
}

export async function getSupportCounts(): Promise<Record<string, number> | null> {
  await requireAdmin("support.view");
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data, error } = await admin.rpc("fitx_admin_support_counts");
  if (error) {
    if (!isMissingFunction(error)) logServerError("data.support_counts", error);
    return null;
  }
  const result: Record<string, number> = {};
  for (const [status, value] of Object.entries((data as Record<string, unknown> | null) ?? {})) {
    const parsed = count(value);
    if (parsed !== null) result[status] = parsed;
  }
  return result;
}

export type OverviewExtras = {
  suspended: number;
  /** Accounts per sign-in method (an account with two methods counts in both). */
  methods: Record<string, number>;
  /** The latest live subscription's status per account. */
  subscriptions: Record<string, number>;
  premium: number;
};

export type OverviewExtrasResult = { state: "ready"; extras: OverviewExtras } | { state: "service_key_missing" | "migration_pending" | "query_failed" };

function countMap(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const parsed = count(raw);
    if (parsed === null) return null;
    result[key] = parsed;
  }
  return result;
}

/** Suspensions, sign-in methods and subscription counts for the Dashboard (overview.view). */
export async function getOverviewExtras(): Promise<OverviewExtrasResult> {
  await requireAdmin("overview.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };
  const { data, error } = await admin.rpc("fitx_admin_overview_extras");
  if (error) {
    if (isMissingFunction(error)) return { state: "migration_pending" };
    logServerError("data.overview_extras", error);
    return { state: "query_failed" };
  }
  const source = (data ?? {}) as Record<string, unknown>;
  const suspended = count(source.suspended);
  const premium = count(source.premium);
  const methods = countMap(source.methods);
  const subscriptions = countMap(source.subscriptions);
  if (suspended === null || premium === null || !methods || !subscriptions) {
    logServerError("data.overview_extras", { message: "the overview function returned a value that is not a count" });
    return { state: "query_failed" };
  }
  return { state: "ready", extras: { suspended, premium, methods, subscriptions } };
}
