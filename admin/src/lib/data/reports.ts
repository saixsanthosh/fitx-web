import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { isContentMigrationMissing } from "@/lib/content/errors";
import { parseReport, type Report, type ReportRange } from "@/lib/content/report";
import { logServerError } from "@/lib/log";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type ReportResult = { state: "ready"; report: Report } | { state: "service_key_missing" | "migration_pending" | "query_failed" };

/** The Reports aggregates from fitx_admin_op_report: counts and sums only, never a member's rows. */
export async function getReport(days: ReportRange): Promise<ReportResult> {
  const operator = await requireAdmin("reports.view");
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" };
  const { data, error } = await supabase.rpc("fitx_admin_op_report", { p_operator_id: operator.id, p_days: days });
  if (error) {
    if (isContentMigrationMissing(error)) return { state: "migration_pending" };
    logServerError("data.report", error);
    return { state: "query_failed" };
  }
  const report = parseReport(data);
  if (!report) {
    logServerError("data.report", { message: "the report function returned values that are not counts" });
    return { state: "query_failed" };
  }
  return { state: "ready", report };
}
