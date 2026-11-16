import type { Metadata } from "next";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { isSuspended, searchPeople } from "@/lib/data/people";
import { ROLE_LABELS } from "@/lib/roles";
import { MIGRATIONS } from "@/lib/schema";
import { formatIstDate } from "@/lib/time";

export const metadata: Metadata = { title: "People" };

const PROVIDER_LABELS: Record<string, string> = { email: "Email and password", google: "Google", apple: "Apple" };

function dateLabel(value: string | null | undefined, empty = "Never signed in") {
  if (!value) return empty;
  return formatIstDate(value) ?? "Date unavailable";
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; notice?: string }> }) {
  await requireAdmin("people.view");
  const params = await searchParams;
  const query = (params.q ?? "").slice(0, 120);
  const result = await searchPeople(query, Number(params.page ?? "1"));
  const pageLink = (page: number) => `/users?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page) }).toString()}`;

  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><p className="eyebrow">ACCOUNT DIRECTORY</p><h1>People</h1><p className="page-lede">FITX accounts from Supabase Auth: sign-in details only, never profiles or health data.</p></div><span className="page-heading-icon"><Users aria-hidden="true" size={20} /></span></div>
      {params.notice === "deleted" && <p className="inline-notice notice-success" role="status">The account was deleted and recorded in the audit log.</p>}
      {result.state === "ready" ? (
        <section className="table-panel" aria-label="FITX accounts">
          <form action="/users" className="table-search">
            <label className="search-label" htmlFor="people-search"><Search aria-hidden="true" size={17} />Find an account</label>
            <div><input id="people-search" name="q" defaultValue={query} maxLength={120} placeholder="Part of an email address, or an account ID" disabled={!result.searchAvailable} /><button className="quiet-button" type="submit" disabled={!result.searchAvailable}>Search</button></div>
          </form>
          {!result.searchAvailable && <p className="table-note">Search starts working once migration <code>{MIGRATIONS.people}</code> is applied. Until then this list pages through all accounts.</p>}
          {result.people.length ? <div className="table-scroll"><table><thead><tr><th>Account</th><th>Created (IST)</th><th>Last sign-in (IST)</th><th>Signs in with</th><th>Status</th></tr></thead><tbody>
            {result.people.map((person) => {
              const suspended = isSuspended(person.bannedUntil);
              return <tr key={person.id}>
                <td><Link className="user-cell row-link" href={`/users/${person.id}`}><span className="user-initial">{(person.email ?? "?").slice(0, 1).toUpperCase()}</span><span><strong>{person.email ?? "No email"}</strong>{person.adminRole && <small className="table-subline">Admin team · {ROLE_LABELS[person.adminRole]}</small>}</span></Link></td>
                <td>{dateLabel(person.createdAt, "Date unavailable")}</td>
                <td>{dateLabel(person.lastSignInAt)}</td>
                <td>{person.providers.map((provider) => PROVIDER_LABELS[provider] ?? provider).join(", ") || "—"}</td>
                <td><span className={`status-pill ${suspended ? "status-danger" : person.emailConfirmedAt ? "status-good" : "status-neutral"}`}><i />{suspended ? "Suspended" : person.emailConfirmedAt ? "Confirmed" : "Unconfirmed email"}</span></td>
              </tr>;
            })}
          </tbody></table></div> : <div className="empty-state"><h3>No accounts found</h3><p>{query ? "No account email or ID matches that search." : "There are no accounts on this page."}</p></div>}
          <div className="table-footer">
            <span>{result.total !== null ? `${result.total.toLocaleString("en-IN")} ${query ? "matching" : ""} accounts · page ${result.page}` : `Page ${result.page}`}</span>
            <div className="pagination-actions">{result.page > 1 && <Link className="quiet-button" href={pageLink(result.page - 1)}>Previous</Link>}{result.hasNext && <Link className="quiet-button" href={pageLink(result.page + 1)}>Next</Link>}</div>
          </div>
        </section>
      ) : <ModuleState state={result.state} />}
      <p className="privacy-note">Opening this list or an account is recorded in the audit log. Workout, nutrition and body data stay outside Admin.</p>
    </div>
  );
}
