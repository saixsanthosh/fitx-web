import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { logServerError } from "@/lib/log";
import { isMissingSchema } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type SecurityOverview = {
  succeeded24h: number;
  failed24h: number;
  failed7d: number;
  ipLimitedNow: number;
  locked: Array<{ operatorId: string; username: string; lockedUntil: string }>;
  lockedUnknown: number;
  daily: Array<{ day: string; succeeded: number; failed: number }>;
};

export type SecurityOverviewResult = { state: "ready"; overview: SecurityOverview } | { state: "service_key_missing" | "migration_pending" | "query_failed" };

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);

/** Sign-in attempts, limits reached and locks now (security.view). Counts and usernames only. */
export async function getSecurityOverview(): Promise<SecurityOverviewResult> {
  await requireAdmin("security.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };
  const { data, error } = await admin.rpc("fitx_admin_security_overview");
  if (error) {
    if (isMissingSchema(error)) return { state: "migration_pending" };
    logServerError("data.security_overview", error);
    return { state: "query_failed" };
  }
  const source = (data ?? {}) as Record<string, unknown>;
  return {
    state: "ready",
    overview: {
      succeeded24h: count(source.succeeded_24h),
      failed24h: count(source.failed_24h),
      failed7d: count(source.failed_7d),
      ipLimitedNow: count(source.ip_limited_now),
      locked: (Array.isArray(source.locked) ? source.locked : []).map((row) => {
        const entry = row as Record<string, unknown>;
        return { operatorId: String(entry.operator_id), username: String(entry.username), lockedUntil: String(entry.locked_until) };
      }),
      lockedUnknown: count(source.locked_unknown),
      daily: (Array.isArray(source.daily) ? source.daily : []).map((row) => {
        const entry = row as Record<string, unknown>;
        return { day: String(entry.day), succeeded: count(entry.succeeded), failed: count(entry.failed) };
      }),
    },
  };
}
