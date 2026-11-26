import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHead, consoleStyles as ui } from "@/components/console/ui";
import { ModuleState } from "@/components/module-state";
import { SectionCountReport } from "@/components/section-counts";
import styles from "@/components/support/support.module.css";
import { requireAdmin } from "@/lib/admin-auth";
import { listSupportRequests, parseSupportFilters, type SupportFilters } from "@/lib/data/support";
import { pageNotice } from "@/lib/notice";
import { MIGRATIONS } from "@/lib/schema";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_SHORT,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUSES,
  type SupportStatus,
} from "@/lib/support-catalog";
import { formatIstDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Support" };

const ACTIVE = ["open", "in_progress", "waiting_on_user"] as const;

/** The requests that need attention, or null when any of their counts could not be read (never a partial sum). */
function needingAttention(counts: Record<SupportStatus, number | null>): number | null {
  let sum = 0;
  for (const status of ACTIVE) {
    const count = counts[status];
    if (count === null) return null;
    sum += count;
  }
  return sum;
}

/** A count that could not be read is null and shows as "Not known", never as 0. */
const countText = (count: number | null) => (count === null ? "Not known" : count.toLocaleString("en-IN"));

function queueLink(filters: SupportFilters, overrides: Partial<SupportFilters>) {
  const merged = { ...filters, ...overrides };
  const query = new URLSearchParams();
  if (merged.status !== "active") query.set("status", merged.status);
  if (merged.category) query.set("category", merged.category);
  if (merged.mine) query.set("mine", "1");
  if (merged.unread) query.set("unread", "1");
  if (merged.page > 1) query.set("page", String(merged.page));
  const text = query.toString();
  return `/support${text ? `?${text}` : ""}`;
}

function statusTone(status: string) {
  return status === "open" ? "status-danger" : status === "waiting_on_user" ? "status-warn" : status === "resolved" || status === "closed" ? "status-neutral" : "status-good";
}

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("support.view");
  const params = await searchParams;
  const filters = parseSupportFilters(params);
  const result = await listSupportRequests(filters);
  const waiting = result.state === "ready" ? needingAttention(result.counts) : null;
  const meta = result.state === "ready"
    ? [result.inbox.unread === null ? null : `${result.inbox.unread.toLocaleString("en-IN")} unread`, waiting === null ? null : `${waiting.toLocaleString("en-IN")} need attention`].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="page-stack">
      {/* The menu's badge says what this inbox says, also when the operator came here from another page. */}
      {result.state === "ready" && <SectionCountReport href="/support" count={result.inbox.unread} at={result.countedAt} />}
      <PageHead
        eyebrow="Support"
        title="Inbox"
        meta={meta || undefined}
      />
      {pageNotice(params.notice, actor.id)?.code === "not_found" && <Notice tone="error">That request no longer exists.</Notice>}
      {result.state === "ready" ? (
        <section className="table-panel" aria-label="Support inbox">
          <nav className={styles.tabs} aria-label="Category">
            <Link className={styles.tab} aria-current={!filters.category ? "page" : undefined} href={queueLink(filters, { category: null, page: 1 })}>All</Link>
            {SUPPORT_CATEGORIES.map((category) => {
              const unread = result.inbox.unreadByCategory?.[category] ?? 0;
              return (
                <Link key={category} className={styles.tab} aria-current={filters.category === category ? "page" : undefined} href={queueLink(filters, { category, page: 1 })}>
                  {SUPPORT_CATEGORY_SHORT[category]}
                  {unread > 0 && <span className={styles.badge}><span aria-hidden="true">{unread}</span><span className="sr-only">{unread} unread</span></span>}
                </Link>
              );
            })}
          </nav>
          <nav className="filter-tabs" aria-label="Status">
            <Link aria-current={filters.status === "active" && !filters.unread ? "page" : undefined} href={queueLink(filters, { status: "active", unread: false, page: 1 })}>Needs attention <b>{countText(waiting)}</b></Link>
            {result.inbox.unread !== null && <Link aria-current={filters.unread ? "page" : undefined} href={queueLink(filters, { status: "all", unread: true, page: 1 })}>Unread <b>{result.inbox.unread}</b></Link>}
            {SUPPORT_STATUSES.map((status) => <Link key={status} aria-current={filters.status === status && !filters.unread ? "page" : undefined} href={queueLink(filters, { status, unread: false, page: 1 })}>{SUPPORT_STATUS_LABELS[status]} <b>{countText(result.counts[status])}</b></Link>)}
            <Link aria-current={filters.status === "all" && !filters.unread ? "page" : undefined} href={queueLink(filters, { status: "all", unread: false, page: 1 })}>All</Link>
            <Link aria-current={filters.mine ? "page" : undefined} href={queueLink(filters, { mine: !filters.mine, page: 1 })}>Assigned to me</Link>
          </nav>
          {result.rows.length ? (
            <ul className={`${styles.list} ${ui.stagger}`}>
              {result.rows.map((row) => (
                <li key={row.id} className={`${styles.item}${row.unread ? ` ${styles.unread}` : ""}`}>
                  <Link className={styles.link} href={`/support/${row.id}`}>
                    <span className={styles.dot} aria-hidden="true" />
                    <span className={styles.top}>
                      <span className={styles.subject}>{row.unread && <span className="sr-only">Unread: </span>}{row.subject}</span>
                      <time className={styles.when} dateTime={row.lastMessageAt}>{formatIstDateTime(row.lastMessageAt) ?? ""}</time>
                    </span>
                    <span className={styles.meta}>
                      <span className={`status-pill ${row.category === "complaint" ? styles.complaint : "status-neutral"}`}>{SUPPORT_CATEGORY_SHORT[row.category] ?? row.category}</span>
                      <span className={`status-pill ${statusTone(row.status)}`}><i />{SUPPORT_STATUS_LABELS[row.status]}</span>
                      <span>{row.requesterEmail ?? row.requesterId.slice(0, 8)}</span>
                      {row.priority !== "normal" && <span>{SUPPORT_PRIORITY_LABELS[row.priority]} priority</span>}
                      {row.assigneeLabel && <span>· {row.assigneeLabel}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="empty-state"><h3>Nothing here</h3><p>No requests match.</p></div>}
          <div className="table-footer">
            <span>{result.total.toLocaleString("en-IN")} requests</span>
            <div className="pagination-actions">
              {filters.page > 1 && <Link className="quiet-button" href={queueLink(filters, { page: filters.page - 1 })}>Previous</Link>}
              {result.hasNext && <Link className="quiet-button" href={queueLink(filters, { page: filters.page + 1 })}>Next</Link>}
            </div>
          </div>
        </section>
      ) : <ModuleState state={result.state} migration={MIGRATIONS.support} />}
    </div>
  );
}
