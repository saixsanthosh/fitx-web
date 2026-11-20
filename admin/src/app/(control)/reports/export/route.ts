import { requireAdmin } from "@/lib/admin-auth";
import { logAdminEvent } from "@/lib/audit";
import { isExportKind, parseRange, reportCsv } from "@/lib/content/report";
import { getReport } from "@/lib/data/reports";

export const dynamic = "force-dynamic";

/** One report as CSV (aggregates only). Every export is written to the audit log. */
export async function GET(request: Request) {
  const actor = await requireAdmin("reports.view");
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (!isExportKind(kind)) return new Response("Unknown report", { status: 400, headers: { "cache-control": "no-store" } });
  const days = parseRange(url.searchParams.get("days"));
  const result = await getReport(days);
  if (result.state !== "ready") return new Response("The report could not be loaded", { status: 503, headers: { "cache-control": "no-store" } });
  // No audit row, no file.
  const logged = await logAdminEvent({ actor, action: "report_exported", resourceType: "report", resourceId: kind, details: { kind, days } });
  if (!logged.ok) return new Response("The export could not be recorded", { status: 503, headers: { "cache-control": "no-store" } });
  const name = `fitx-${kind}-${result.report.to || "report"}-${days}d.csv`;
  return new Response(`\uFEFF${reportCsv(result.report, kind)}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
