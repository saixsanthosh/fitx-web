import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { Notice, PageHead, consoleStyles as ui } from "@/components/console/ui";
import { ModuleState } from "@/components/module-state";
import { ADMIN_OPS_MIGRATION } from "@/components/settings/settings-rules";
import {
  BULK_SUSPEND_MAX,
  hasFilters,
  methodLabels,
  parsePeopleFilters,
  peopleHref,
  PEOPLE_PLANS,
  PEOPLE_STATUSES,
  PEOPLE_STATUS_LABELS,
  PLAN_LABELS,
  SIGN_IN_METHODS,
  METHOD_LABELS,
  subscriptionLabel,
  formatPhone,
} from "@/components/users/people-filters";
import { BulkUsersForm } from "@/components/users/bulk-users-form";
import { LIST_NOTICES } from "@/components/users/people-notices";
import { SelectAll } from "@/components/users/select-all";
import styles from "@/components/users/users.module.css";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { isSuspended, searchPeopleFiltered } from "@/lib/data/people";
import { noticeWords, pageNotice } from "@/lib/notice";
import { openPeopleSearch, PEOPLE_SEARCH_PARAM } from "@/lib/people-search";
import { ROLE_LABELS } from "@/lib/roles";
import { MIGRATIONS } from "@/lib/schema";
import { firstParam } from "@/lib/search-params";
import { formatIstDate } from "@/lib/time";
import { searchUsers } from "./actions";

export const metadata: Metadata = { title: "Users" };

function dateLabel(value: string | null | undefined, empty: string) {
  if (!value) return empty;
  return formatIstDate(value) ?? "Unknown";
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("people.view");
  const params = await searchParams;
  const searchToken = firstParam(params[PEOPLE_SEARCH_PARAM]);
  const query = searchToken ? openPeopleSearch(searchToken, actor.id) : null;
  const filters = parsePeopleFilters(params, query ?? "");
  const result = await searchPeopleFiltered(filters);
  const opened = pageNotice(params.notice, actor.id);
  const notice = noticeWords(LIST_NOTICES, opened);
  const canSuspend = hasPermission(actor, "people.suspend");
  const canNotify = hasPermission(actor, "notifications.send");
  const bulk = canSuspend || canNotify;
  const here = peopleHref(filters, {}, searchToken);

  return (
    <div className="page-stack">
      <PageHead
        eyebrow="Users"
        title="Accounts"
        meta={result.state === "ready" && result.total !== null ? `${result.total.toLocaleString("en-IN")} ${hasFilters(filters) ? "matching" : "accounts"}` : undefined}
      />
      {notice && <Notice tone={notice.tone}>{notice.text(opened?.count ?? null)}</Notice>}
      {searchToken && query === null && <Notice tone="error">That search has expired. Search again.</Notice>}

      {result.state === "ready" ? (
        <section className="table-panel" aria-label="Accounts">
          <form action={searchUsers} className={ui.toolbar} role="search">
            <label className={ui.wide}>
              <span><Search aria-hidden="true" size={14} /> Search</span>
              <input name="q" type="search" defaultValue={filters.q} maxLength={120} placeholder="Email, phone, name or ID" disabled={!result.searchAvailable} />
            </label>
            <label>Status
              <select name="status" defaultValue={filters.status ?? ""} disabled={!result.filtersAvailable}>
                <option value="">Any</option>
                {PEOPLE_STATUSES.map((status) => <option key={status} value={status}>{PEOPLE_STATUS_LABELS[status]}</option>)}
              </select>
            </label>
            <label>Signs in with
              <select name="method" defaultValue={filters.method ?? ""} disabled={!result.filtersAvailable}>
                <option value="">Any</option>
                {SIGN_IN_METHODS.map((method) => <option key={method} value={method}>{METHOD_LABELS[method]}</option>)}
              </select>
            </label>
            <label>Plan
              <select name="plan" defaultValue={filters.plan ?? ""} disabled={!result.filtersAvailable}>
                <option value="">Any</option>
                {PEOPLE_PLANS.map((plan) => <option key={plan} value={plan}>{PLAN_LABELS[plan]}</option>)}
              </select>
            </label>
            <button className="primary-button" type="submit">Apply</button>
            {hasFilters(filters) && <Link className="text-link" href="/users">Clear</Link>}
          </form>
          {!result.filtersAvailable && <p className="table-note">Filters need migration <code>{ADMIN_OPS_MIGRATION}</code>.{!result.searchAvailable && <> Search needs <code>{MIGRATIONS.people}</code>.</>}</p>}

          {result.people.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {bulk && <th className={styles.check}><label className={styles.checkLabel}><SelectAll form="bulk-users" /></label></th>}
                    <th>Account</th><th>Signs in with</th><th>Status</th><th>Plan</th><th>Joined</th><th>Last sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {result.people.map((person) => {
                    const suspended = isSuspended(person.bannedUntil);
                    const plan = subscriptionLabel(person.subscriptionStatus, person.premium);
                    const phone = formatPhone(person.phone);
                    const name = person.email ?? phone ?? "No email or phone";
                    return (
                      <tr key={person.id}>
                        {bulk && <td className={styles.check}><label className={styles.checkLabel}><input type="checkbox" name="ids" value={person.id} form="bulk-users" aria-label={`Select ${name}`} /></label></td>}
                        <td>
                          <Link className="user-cell row-link" href={`/users/${person.id}`}>
                            <span className="user-initial" aria-hidden="true">{(person.displayName ?? name).slice(0, 1).toUpperCase()}</span>
                            <span><strong>{name}</strong><small className="table-subline">{[person.displayName, person.email && phone ? phone : null, person.adminRole ? `Old Admin team · ${ROLE_LABELS[person.adminRole]}` : null].filter(Boolean).join(" · ") || " "}</small></span>
                          </Link>
                        </td>
                        <td><span className={styles.methods}>{methodLabels(person.providers).map((label) => <span key={label} className={styles.method}>{label}</span>)}{!person.providers.length && "–"}</span></td>
                        <td><span className={`status-pill ${suspended ? "status-danger" : "status-good"}`}><i />{suspended ? "Suspended" : "Active"}</span>{!suspended && !person.emailConfirmedAt && <small className="table-subline">Unconfirmed</small>}</td>
                        <td>{plan ? <span className={`status-pill ${plan.tone === "good" ? "status-good" : plan.tone === "warn" ? "status-warn" : "status-neutral"}`}>{plan.text}</span> : <span aria-label="Not known">–</span>}</td>
                        <td>{dateLabel(person.createdAt, "Unknown")}</td>
                        <td>{dateLabel(person.lastSignInAt, "Never")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state"><h3>No accounts found</h3><p>{hasFilters(filters) ? "Nothing matches these filters." : "No accounts yet."}</p></div>
          )}

          {bulk && result.people.length > 0 && <BulkUsersForm here={here} canSuspend={canSuspend} canNotify={canNotify} max={BULK_SUSPEND_MAX} />}

          <div className="table-footer">
            <span>{result.total !== null ? `Page ${result.page} of ${Math.max(1, Math.ceil(result.total / 25)).toLocaleString("en-IN")}` : `Page ${result.page}`}</span>
            <div className="pagination-actions">
              {result.page > 1 && <Link className="quiet-button" href={peopleHref(filters, { page: result.page - 1 }, searchToken)}>Previous</Link>}
              {result.hasNext && <Link className="quiet-button" href={peopleHref(filters, { page: result.page + 1 }, searchToken)}>Next</Link>}
            </div>
          </div>
        </section>
      ) : <ModuleState state={result.state} />}
      <p className="privacy-note">{result.state === "ready" && !result.viewLogged.ok ? "This view could not be written to the audit log. " : "Every view is written to the audit log. "}No workout, meal or body data is shown here.</p>
    </div>
  );
}
