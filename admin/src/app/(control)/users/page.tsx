import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { listRecentUsers } from "@/lib/admin-data";
import { ModuleState } from "@/components/module-state";
import { formatIstDate } from "@/lib/time";

export const metadata: Metadata = { title: "People" };

function dateLabel(value: string | null | undefined) {
  if (!value) return "Never signed in";
  return formatIstDate(value) ?? "Date unavailable";
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const result = await listRecentUsers(Number(params.page ?? "1"));
  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><p className="eyebrow">ACCOUNT DIRECTORY</p><h1>People</h1><p className="page-lede">Account and sign-in records from Supabase Auth.</p></div><span className="page-heading-icon"><Users aria-hidden="true" size={20} /></span></div>
      {result.state === "ready" ? (
        <section className="table-panel" aria-label="Recent user accounts">
          <div className="table-heading"><div><h2>Recent accounts</h2><p>Latest 50 records in the selected Auth page. Dates are in IST. Personal fitness metrics are not shown here.</p></div><span className="data-badge">Live records</span></div>
          {result.users.length ? <div className="table-scroll"><table><thead><tr><th>Account</th><th>Created</th><th>Last sign-in</th><th>Status</th><th>Reference</th></tr></thead><tbody>
            {result.users.map((account) => {
              const recentlyActive = account.lastSignInAt && result.generatedAt - Date.parse(account.lastSignInAt) <= 30 * 24 * 60 * 60 * 1000;
              const suspended = account.bannedUntil && Date.parse(account.bannedUntil) > result.generatedAt;
              return <tr key={account.id}><td><span className="user-cell"><span className="user-initial">{account.email.slice(0, 1).toUpperCase()}</span><strong>{account.email}</strong></span></td><td>{dateLabel(account.createdAt)}</td><td>{dateLabel(account.lastSignInAt)}</td><td><span className={`status-pill ${suspended ? "status-danger" : recentlyActive ? "status-good" : "status-neutral"}`}><i />{suspended ? "Suspended" : recentlyActive ? "Active · 30d" : "Registered"}</span></td><td className="mono-cell">{account.id}</td></tr>;
            })}
          </tbody></table></div> : <div className="empty-state"><h3>No Auth records returned</h3><p>There are no users on this page.</p></div>}
          <div className="table-footer"><span>Page {result.page} · Records from the connected Auth project</span><div className="pagination-actions">{result.page > 1 && <a className="quiet-button" href={`/users?page=${result.page - 1}`}>Previous</a>}{result.hasNext && <a className="quiet-button" href={`/users?page=${result.page + 1}`}>Next</a>}</div></div>
        </section>
      ) : <ModuleState state={result.state} />}
      <p className="privacy-note">FITX Admin limits this view to account identifiers and authentication timestamps. Workout and nutrition details remain outside this directory.</p>
    </div>
  );
}
