import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Flag, Image as ImageIcon, MessageCircle, MessagesSquare, Trophy, UserRound, Users } from "lucide-react";
import { Notice, PageHead, consoleStyles as ui } from "@/components/console/ui";
import styles from "@/components/explore/explore.module.css";
import { MeterCard } from "@/components/explore/meter-card";
import { exploreNotice } from "@/components/explore/notices";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { getExploreMeter, listReports } from "@/lib/data/explore";
import { EXPLORE_MIGRATION, REASON_LABELS, REPORT_STATUSES, STATUS_LABELS, TARGET_LABELS, TARGET_TYPES, parseQueueFilters, queueHref, type TargetType } from "@/lib/explore-rules";
import { firstParam } from "@/lib/search-params";
import { formatIstDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Explore" };

const ICONS: Record<TargetType, typeof Flag> = { post: ImageIcon, comment: MessageCircle, story: BookOpen, message: MessagesSquare, community: Users, challenge: Trophy, account: UserRound };

function statusTone(status: string) {
  return status === "open" ? "status-danger" : status === "reviewing" ? "status-warn" : status === "actioned" ? "status-good" : "status-neutral";
}

export default async function ExploreQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("explore.view");
  const params = await searchParams;
  const filters = parseQueueFilters(params);
  const [result, meter] = await Promise.all([listReports(filters), getExploreMeter()]);
  const notice = exploreNotice(firstParam(params.notice));
  // A count that could not be read is null and shows as "Not known", never as 0.
  const waiting = result.state === "ready" && result.counts.open !== null && result.counts.reviewing !== null
    ? result.counts.open + result.counts.reviewing
    : null;
  const countText = (count: number | null) => (count === null ? "Not known" : count.toLocaleString("en-IN"));

  return (
    <div className="page-stack">
      <PageHead eyebrow="Explore" title="Queue" meta={waiting === null ? undefined : waiting === 0 ? "Nothing waiting" : `${waiting.toLocaleString("en-IN")} waiting, oldest first`} />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {result.state === "ready" ? (
        <div className={styles.layout}>
          <section className={`table-panel ${ui.rise}`} aria-label="Reports">
            <nav className="filter-tabs" aria-label="Status">
              <Link aria-current={filters.status === "waiting" ? "page" : undefined} href={queueHref(filters, { status: "waiting", page: 1 })}>Waiting <b>{countText(waiting)}</b></Link>
              {REPORT_STATUSES.map((status) => (
                <Link key={status} aria-current={filters.status === status ? "page" : undefined} href={queueHref(filters, { status, page: 1 })}>{STATUS_LABELS[status]} <b>{countText(result.counts[status])}</b></Link>
              ))}
              <Link aria-current={filters.status === "all" ? "page" : undefined} href={queueHref(filters, { status: "all", page: 1 })}>All</Link>
            </nav>
            <nav className={styles.tabs} aria-label="Kind">
              <Link className={styles.tab} aria-current={!filters.target ? "page" : undefined} href={queueHref(filters, { target: null, page: 1 })}>Everything</Link>
              {TARGET_TYPES.map((type) => (
                <Link key={type} className={styles.tab} aria-current={filters.target === type ? "page" : undefined} href={queueHref(filters, { target: type, page: 1 })}>{TARGET_LABELS[type]}</Link>
              ))}
            </nav>
            {result.rows.length ? (
              <ul className={`${styles.list} ${ui.stagger}`}>
                {result.rows.map((row) => {
                  const Icon = ICONS[row.targetType];
                  return (
                    <li key={row.id} className={styles.item}>
                      <Link className={styles.link} href={`/explore/reports/${row.id}`}>
                        <span className={styles.kindIcon} aria-hidden="true"><Icon size={17} strokeWidth={1.8} /></span>
                        <span className={styles.top}>
                          <span className={styles.title}>{TARGET_LABELS[row.targetType]}{row.targetName ? ` by @${row.targetName}` : ""}: {REASON_LABELS[row.reason]}</span>
                          <time className={styles.when} dateTime={row.createdAt}>{formatIstDateTime(row.createdAt) ?? ""}</time>
                        </span>
                        <span className={styles.meta}>
                          <span className={`status-pill ${statusTone(row.status)}`}><i />{STATUS_LABELS[row.status]}</span>
                          {row.waitingOnTarget > 1 && <span className={styles.count}>{row.waitingOnTarget} reports on this</span>}
                          <span>{row.reporterName ? `Reported by @${row.reporterName}` : "Reporter has no Explore profile"}</span>
                          {row.hasDetails && <span>· has a note</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="empty-state"><h3>{filters.status === "waiting" ? "Nothing waiting" : "Nothing here"}</h3><p>{filters.status === "waiting" ? "New reports from members appear here, oldest first." : "No reports match."}</p></div>
            )}
            <div className="table-footer">
              <span>{result.total.toLocaleString("en-IN")} {result.total === 1 ? "report" : "reports"}</span>
              <div className="pagination-actions">
                {filters.page > 1 && <Link className="quiet-button" href={queueHref(filters, { page: filters.page - 1 })}>Previous</Link>}
                {result.hasNext && <Link className="quiet-button" href={queueHref(filters, { page: filters.page + 1 })}>Next</Link>}
              </div>
            </div>
          </section>
          <div className={`${styles.stack} ${ui.onScroll}`}>
            {meter.state === "ready" ? <MeterCard meter={meter.meter} /> : <ModuleState state={meter.state} migration={EXPLORE_MIGRATION} />}
          </div>
        </div>
      ) : <ModuleState state={result.state} migration={EXPLORE_MIGRATION} />}
    </div>
  );
}
