import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { PageHead } from "@/components/console/ui";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  auditActionLabel,
  auditFilterQuery,
  parseAuditFilters,
  summariseAuditDetails,
  type AuditAction,
} from "@/lib/audit-catalog";
import { AUDIT_EXPORT_LIMIT, AUDIT_PAGE_SIZE, listAuditEvents } from "@/lib/data/audit";
import { can } from "@/lib/roles";
import { formatIstDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Audit log" };

const groups = [...new Set(Object.values(AUDIT_ACTIONS).map((entry) => entry.group))];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("audit.view");
  const filters = parseAuditFilters(await searchParams);
  const result = await listAuditEvents(filters);
  const filtered = Boolean(filters.action || filters.actor || filters.resourceType || filters.resourceId || filters.from || filters.to);

  return <div className="page-stack">
    <PageHead
      eyebrow="Admin and security"
      title="Audit log"
      meta="Append-only: rows are never changed or deleted"
      actions={can(actor.role, "audit.export") ? <a className="quiet-button" href={`/audit/export${auditFilterQuery(filters, { page: 1 })}`}><Download aria-hidden="true" size={16} />Export CSV</a> : undefined}
    />
    <form action="/audit" className="table-panel filter-grid" aria-label="Filter the audit log">
      <label>Action<select name="action" defaultValue={filters.action ?? ""}>
        <option value="">Any action</option>
        {groups.map((group) => <optgroup key={group} label={group}>{(Object.keys(AUDIT_ACTIONS) as AuditAction[]).filter((action) => AUDIT_ACTIONS[action].group === group).map((action) => <option key={action} value={action}>{AUDIT_ACTIONS[action].label}</option>)}</optgroup>)}
      </select></label>
      <label>Actor<input name="actor" defaultValue={filters.actor} placeholder="Username, email or ID" /></label>
      <label>Resource<select name="resource" defaultValue={filters.resourceType ?? ""}><option value="">Any</option>{AUDIT_RESOURCE_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
      <label>Resource ID<input name="resource_id" defaultValue={filters.resourceId} placeholder="Exact ID" /></label>
      <label>From (IST)<input type="date" name="from" defaultValue={filters.from} /></label>
      <label>To (IST)<input type="date" name="to" defaultValue={filters.to} /></label>
      <div className="filter-actions"><button className="primary-button" type="submit">Filter</button>{filtered && <Link className="text-link" href="/audit">Clear</Link>}</div>
    </form>
    {result.state === "ready" ? <section className="table-panel">
      <div className="table-heading"><div><h2>{filtered ? "Matching events" : "Recent events"}</h2><p>Newest first, {AUDIT_PAGE_SIZE} a page.{can(actor.role, "audit.export") ? ` Exports hold up to ${AUDIT_EXPORT_LIMIT.toLocaleString("en-IN")} rows and are recorded too.` : ""}</p></div><span className="data-badge">{result.total.toLocaleString("en-IN")} events</span></div>
      {result.actorNote && <p className="table-note">{result.actorNote}</p>}
      {result.rows.length ? <div className="table-scroll"><table><thead><tr><th>Time (IST)</th><th>Action</th><th>Actor</th><th>Resource</th><th>Details</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.id}>
        <td>{formatIstDateTime(row.createdAt) ?? "—"}</td>
        <td><strong>{auditActionLabel(row.action)}</strong></td>
        <td>{row.actorLabel ?? ((row.actorOperatorId ?? row.actorId) ? <span className="mono-cell">{(row.actorOperatorId ?? row.actorId)?.slice(0, 8)}</span> : "—")}</td>
        <td>{row.resourceType.replaceAll("_", " ")}{row.resourceId && <small className="table-subline mono-cell">{row.resourceId}</small>}</td>
        <td className="details-cell">{summariseAuditDetails(row.details) || "—"}</td>
      </tr>)}</tbody></table></div> : <div className="empty-state"><h3>No events</h3><p>{filtered ? "Nothing matches these filters." : "Audited changes will appear here."}</p></div>}
      <div className="table-footer"><span>Page {result.page}</span><div className="pagination-actions">{result.page > 1 && <Link className="quiet-button" href={`/audit${auditFilterQuery(filters, { page: result.page - 1 })}`}>Newer</Link>}{result.hasNext && <Link className="quiet-button" href={`/audit${auditFilterQuery(filters, { page: result.page + 1 })}`}>Older</Link>}</div></div>
    </section> : <ModuleState state={result.state} />}
  </div>;
}
