import type { Metadata } from "next";
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { listSupportRequests, parseSupportFilters, type SupportFilters } from "@/lib/data/support";
import { MIGRATIONS } from "@/lib/schema";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUSES,
} from "@/lib/support-catalog";
import { formatIstDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Support" };

const ACTIVE = ["open", "in_progress", "waiting_on_user"] as const;

function queueLink(filters: SupportFilters, overrides: Partial<SupportFilters>) {
  const merged = { ...filters, ...overrides };
  const query = new URLSearchParams();
  if (merged.status !== "active") query.set("status", merged.status);
  if (merged.category) query.set("category", merged.category);
  if (merged.mine) query.set("mine", "1");
  if (merged.page > 1) query.set("page", String(merged.page));
  const text = query.toString();
  return `/support${text ? `?${text}` : ""}`;
}

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("support.view");
  const params = await searchParams;
  const filters = parseSupportFilters(params);
  const result = await listSupportRequests(filters);

  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><p className="eyebrow">CUSTOMER CARE</p><h1>Support</h1><p className="page-lede">Help requests and feedback sent from the Help page in the FITX app. Replies appear to the person on that page.</p></div><span className="page-heading-icon"><CircleHelp aria-hidden="true" size={20} /></span></div>
      {params.notice === "not_found" && <p className="inline-notice notice-error" role="status">That request no longer exists.</p>}
      {result.state === "ready" ? (
        <section className="table-panel" aria-label="Support queue">
          <nav className="filter-tabs" aria-label="Status">
            <Link aria-current={filters.status === "active" ? "page" : undefined} href={queueLink(filters, { status: "active", page: 1 })}>Needs attention <b>{ACTIVE.reduce((sum, status) => sum + (result.counts[status] ?? 0), 0)}</b></Link>
            {SUPPORT_STATUSES.map((status) => <Link key={status} aria-current={filters.status === status ? "page" : undefined} href={queueLink(filters, { status, page: 1 })}>{SUPPORT_STATUS_LABELS[status]} <b>{result.counts[status] ?? 0}</b></Link>)}
            <Link aria-current={filters.status === "all" ? "page" : undefined} href={queueLink(filters, { status: "all", page: 1 })}>All</Link>
          </nav>
          <form action="/support" className="filter-bar">
            {filters.status !== "active" && <input type="hidden" name="status" value={filters.status} />}
            <label>Category<select name="category" defaultValue={filters.category ?? ""}><option value="">Any</option>{SUPPORT_CATEGORIES.map((category) => <option key={category} value={category}>{SUPPORT_CATEGORY_LABELS[category]}</option>)}</select></label>
            <label className="check-label"><input type="checkbox" name="mine" value="1" defaultChecked={filters.mine} />Assigned to me</label>
            <button className="quiet-button" type="submit">Apply</button>
          </form>
          {result.rows.length ? <div className="table-scroll"><table><thead><tr><th>Request</th><th>From</th><th>Status</th><th>Priority</th><th>Assigned to</th><th>Last message (IST)</th></tr></thead><tbody>
            {result.rows.map((row) => <tr key={row.id}>
              <td><Link className="row-link" href={`/support/${row.id}`}><strong>{row.subject}</strong><small className="table-subline">{SUPPORT_CATEGORY_LABELS[row.category]}</small></Link></td>
              <td>{row.requesterEmail ?? <span className="mono-cell">{row.requesterId.slice(0, 8)}</span>}</td>
              <td><span className={`status-pill ${row.status === "open" ? "status-danger" : row.status === "resolved" || row.status === "closed" ? "status-neutral" : "status-good"}`}><i />{SUPPORT_STATUS_LABELS[row.status]}</span></td>
              <td>{SUPPORT_PRIORITY_LABELS[row.priority]}</td>
              <td>{row.assigneeLabel ?? "—"}</td>
              <td>{formatIstDateTime(row.lastMessageAt) ?? "—"}</td>
            </tr>)}
          </tbody></table></div> : <div className="empty-state"><h3>No requests here</h3><p>Nothing matches these filters.</p></div>}
          <div className="table-footer"><span>{result.total.toLocaleString("en-IN")} requests</span><div className="pagination-actions">{filters.page > 1 && <Link className="quiet-button" href={queueLink(filters, { page: filters.page - 1 })}>Previous</Link>}{result.hasNext && <Link className="quiet-button" href={queueLink(filters, { page: filters.page + 1 })}>Next</Link>}</div></div>
        </section>
      ) : <ModuleState state={result.state} migration={MIGRATIONS.support} />}
    </div>
  );
}
