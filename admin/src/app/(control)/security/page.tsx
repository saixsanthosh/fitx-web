import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { listAdminSessions } from "@/lib/admin-session";
import { formatIstDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Security" };

// A first view of the session contract; the admin-core stream builds the full Security section
// (login history, lockouts, revoking sessions).
export default async function SecurityPage() {
  await requireAdmin("security.view");
  const result = await listAdminSessions({ activeOnly: true, limit: 50 });
  return <div className="page-stack">
    <div className="page-heading-row"><div><p className="eyebrow">ADMIN AND SECURITY</p><h1>Security</h1></div><span className="page-heading-icon"><ShieldCheck aria-hidden="true" size={20} /></span></div>
    {result.state !== "ready" ? <ModuleState state={result.state} /> : <section className="table-panel">
      <div className="table-heading"><div><h2>Active sessions</h2></div><span className="data-badge">{result.sessions.length}</span></div>
      {result.sessions.length ? <div className="table-scroll"><table><thead><tr><th>Operator</th><th>Signed in (IST)</th><th>Last seen (IST)</th><th>Browser</th></tr></thead><tbody>
        {result.sessions.map((session) => <tr key={session.id}>
          <td><strong>{session.username ?? "—"}</strong>{session.isCurrent && <small className="table-subline">This browser</small>}</td>
          <td>{formatIstDateTime(session.createdAt) ?? "—"}</td>
          <td>{formatIstDateTime(session.lastSeenAt) ?? "—"}</td>
          <td className="details-cell">{session.userAgent ?? "—"}</td>
        </tr>)}
      </tbody></table></div> : <div className="empty-state"><h3>No active sessions</h3></div>}
    </section>}
  </div>;
}
