import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { listAuditEvents } from "@/lib/admin-data";

export const metadata: Metadata = { title: "Audit log" };
export default async function AuditPage() {
  await requireAdmin();
  const result = await listAuditEvents();
  return <div className="page-stack">
    <div className="page-heading-row"><div><p className="eyebrow">ACCOUNTABILITY</p><h1>Audit log</h1><p className="page-lede">Recorded privileged changes from the Admin control plane.</p></div><span className="page-heading-icon"><ScrollText aria-hidden="true" size={20} /></span></div>
    {result.state === "ready" ? <section className="table-panel"><div className="table-heading"><div><h2>Recent events</h2><p>Most recent 100 events. Event detail payloads are deliberately omitted.</p></div><span className="data-badge">{result.events.length} events</span></div>
      {result.events.length ? <div className="table-scroll"><table><thead><tr><th>Action</th><th>Resource</th><th>Reference</th><th>Actor</th><th>Time</th></tr></thead><tbody>{result.events.map((event) => <tr key={event.id}><td><strong>{event.action.replaceAll("_", " ")}</strong></td><td>{event.resource_type}</td><td className="mono-cell">{event.resource_id ?? "—"}</td><td className="mono-cell">{event.actor_id?.slice(0, 8) ?? "system"}</td><td>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}</td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>No events recorded</h3><p>Successful audited changes will appear here.</p></div>}
    </section> : <ModuleState state={result.state} />}
  </div>;
}
