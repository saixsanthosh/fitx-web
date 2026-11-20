import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { logAdminEvent } from "@/lib/audit";
import { auditActionLabel, parseAuditFilters } from "@/lib/audit-catalog";
import { toCsv } from "@/lib/csv";
import { exportAuditEvents } from "@/lib/data/audit";
import { formatIstDateTime } from "@/lib/time";

/** CSV of the filtered audit log (super-admins). The export itself is recorded first. */
export async function GET(request: NextRequest) {
  const actor = await requireAdmin("audit.export");
  const filters = parseAuditFilters(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const result = await exportAuditEvents(filters);
  if (result.state !== "ready") {
    return NextResponse.json({ error: result.state }, { status: result.state === "migration_pending" ? 503 : 500 });
  }

  const logged = await logAdminEvent({
    actor,
    action: "audit_exported",
    resourceType: "audit_log",
    details: {
      rows: result.rows.length,
      total_matching: result.total,
      filters: Object.fromEntries(Object.entries({ ...filters, page: undefined }).filter(([, value]) => value)),
    },
  });
  if (!logged.ok) return NextResponse.json({ error: "audit_unavailable" }, { status: 503 });

  const csv = toCsv(
    ["time_ist", "time_utc", "action", "action_label", "actor", "actor_id", "resource_type", "resource_id", "details"],
    result.rows.map((row) => [
      formatIstDateTime(row.createdAt),
      row.createdAt,
      row.action,
      auditActionLabel(row.action),
      row.actorLabel,
      row.actorOperatorId ?? row.actorId,
      row.resourceType,
      row.resourceId,
      row.details,
    ]),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fitx-admin-audit-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
