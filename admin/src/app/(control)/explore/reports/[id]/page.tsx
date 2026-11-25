import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Notice, Panel, consoleStyles as ui } from "@/components/console/ui";
import styles from "@/components/explore/explore.module.css";
import { ModerationForms } from "@/components/explore/moderation-forms";
import { exploreNotice } from "@/components/explore/notices";
import { ModuleState } from "@/components/module-state";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { logAdminEvent } from "@/lib/audit";
import { getReport } from "@/lib/data/explore";
import { EVIDENCE_LINK_SECONDS, messageStateOf, readEvidence } from "@/lib/data/explore-evidence";
import { ACTION_LABELS, EXPLORE_MIGRATION, REASON_LABELS, SANCTION_LABELS, STATUS_LABELS, TARGET_LABELS, contentActionsFor, isAction, type ModerationAction } from "@/lib/explore-rules";
import { pageNotice } from "@/lib/notice";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { formatIstDate, formatIstDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Explore report" };

const STATE_WORDS = { visible: "Visible", limited: "Limited by FITX", hidden: "Hidden by FITX", gone: "Gone" } as const;

export default async function ExploreReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("explore.view");
  const { id } = await params;
  const query = await searchParams;
  const back = <Link href="/explore" className="text-link back-link"><ArrowLeft aria-hidden="true" size={15} />Queue</Link>;
  const result = await getReport(id, messageStateOf);
  if (result.state === "not_found") notFound();
  if (result.state !== "ready") return <div className="page-stack">{back}<ModuleState state={result.state} migration={EXPLORE_MIGRATION} /></div>;
  const report = result.report;
  const admin = createAdminSupabase();
  const evidence = admin ? await readEvidence(admin, report.targetType, report.evidence) : null;
  // Every look at a report's evidence is on the audit log (ids only).
  await logAdminEvent({ actor, action: "explore_report_viewed", resourceType: "social_report", resourceId: report.id, details: { target_type: report.targetType, status: report.status } });

  const notice = exploreNotice(pageNotice(query.notice, actor.id)?.code);
  const moderator = hasPermission(actor, "explore.moderate");
  const waiting = report.status === "open" || report.status === "reviewing";
  const contentActions = contentActionsFor(report.targetType, report.contentState);
  const memberActions: ModerationAction[] = report.targetUserId && report.targetType !== "challenge" ? ["warn", "clear_avatar", "clear_bio"] : [];
  // Content actions on visible content close the reports, so they are offered while the report waits; unhide and
  // the actions on hidden or limited content stay available after.
  const actions = [...contentActions.filter((action) => waiting || action === "unhide" || report.contentState !== "visible"), ...(waiting ? memberActions : [])];

  return (
    <div className="page-stack">
      {back}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{TARGET_LABELS[report.targetType]} report</p>
          <h1 className="break-anywhere">{REASON_LABELS[report.reason]}</h1>
          <p className="page-lede">
            {report.targetName ? `About @${report.targetName}` : report.targetType === "challenge" ? "About a FITX challenge" : "About a member without an Explore profile"}
            {" · "}reported {formatIstDateTime(report.createdAt)}
            {report.reporterName ? ` by @${report.reporterName}` : ""}
          </p>
        </div>
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className={styles.layout}>
        <div className={styles.stack}>
          <section className={`table-panel ${ui.rise}`} aria-labelledby="evidence-title">
            <div className="table-heading">
              <div>
                <h2 id="evidence-title">What was reported</h2>
                <p>{evidence?.purged ? "The snapshot was removed 90 days after review." : `The reporter's snapshot. Pictures open for ${EVIDENCE_LINK_SECONDS / 60} minutes.`}</p>
              </div>
              <span className={`status-pill ${report.contentState === "limited" || report.contentState === "hidden" ? "status-warn" : "status-neutral"}`}><i />{STATE_WORDS[report.contentState]}</span>
            </div>
            {evidence && !evidence.purged ? (
              <div className={styles.evidence}>
                {evidence.text && <blockquote className={styles.quote}>{evidence.text}</blockquote>}
                {evidence.facts.length > 0 && (
                  <dl className={styles.facts}>{evidence.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
                )}
                {evidence.media.length > 0 && (
                  <ul className={styles.media} aria-label="Pictures and videos">
                    {evidence.media.map((item, index) => (
                      <li key={index}>
                        {item.url ? (
                          item.kind === "video" ? (
                            <video src={item.url} poster={item.posterUrl ?? undefined} controls muted preload="none" playsInline aria-label={`Video ${index + 1}`} />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element -- a 300-second signed Storage link
                            <img src={item.url} alt={`Picture ${index + 1} of the reported ${TARGET_LABELS[report.targetType].toLowerCase()}`} />
                          )
                        ) : <span className={styles.missing}>File no longer stored</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {!evidence.text && !evidence.facts.length && !evidence.media.length && <p className={styles.subtle}>The snapshot holds nothing to show.</p>}
                {report.details && <p className={styles.subtle}><strong>Reporter&apos;s note:</strong> {report.details}</p>}
                {report.evidencePurgeAt && <p className={styles.subtle}>Kept until {formatIstDate(report.evidencePurgeAt)}.</p>}
              </div>
            ) : (
              <div className="empty-state"><h3>No snapshot</h3><p>{report.details ? `Reporter's note: ${report.details}` : "Only the report itself is kept."}</p></div>
            )}
          </section>

          {report.history.length > 0 && (
            <Panel title="What moderators did" className={ui.onScroll}>
              <ul className={styles.history}>
                {report.history.map((entry) => (
                  <li key={entry.id}>
                    <span className={entry.reversedAt ? styles.reversed : undefined}>
                      {isAction(entry.action) ? ACTION_LABELS[entry.action] : entry.action}
                      {entry.reason ? ` · ${REASON_LABELS[entry.reason as keyof typeof REASON_LABELS] ?? entry.reason}` : ""}
                      {entry.actorKind === "member" ? " · a community moderator" : entry.operator ? ` · ${entry.operator}` : ""}
                    </span>
                    <time dateTime={entry.createdAt}>{formatIstDateTime(entry.createdAt)}</time>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <aside className={styles.stack} aria-label="Report details and actions">
          <section className="table-panel side-panel">
            <h2>Details</h2>
            <dl className="detail-list">
              <div className="detail-field"><dt>Status</dt><dd>{STATUS_LABELS[report.status]}{report.reviewedAt ? ` · ${formatIstDateTime(report.reviewedAt)}` : ""}</dd></div>
              <div className="detail-field"><dt>Other reports on it</dt><dd>{report.otherReports.length ? report.otherReports.map((other) => `${REASON_LABELS[other.reason]} (${STATUS_LABELS[other.status].toLowerCase()})`).join(", ") : "None"}</dd></div>
              {report.activeSanctions.length > 0 && (
                <div className="detail-field"><dt>Suspended now</dt><dd>{report.activeSanctions.map((s) => `${SANCTION_LABELS[s.kind]}${s.until ? ` until ${formatIstDate(s.until)}` : " until lifted"}`).join(", ")}</dd></div>
              )}
            </dl>
            {report.targetUserId && <Link className="text-link" href={`/explore/accounts/${report.targetUserId}`}>Open the Explore account</Link>}
          </section>

          {moderator ? (
            <section className={`table-panel ${styles.actions}`} aria-labelledby="actions-title">
              <h2 id="actions-title">Actions</h2>
              {actions.length || waiting || report.activeSanctions.length ? (
                <>
                  <p className={styles.subtle}>Each action closes every open report on this {TARGET_LABELS[report.targetType].toLowerCase()}, tells the reporters FITX reviewed it, and goes on the audit log.</p>
                  <ModerationForms
                    target={{ reportId: report.id }}
                    actions={actions}
                    defaultReason={report.reason}
                    allowSuspend={waiting && Boolean(report.targetUserId) && report.targetType !== "challenge"}
                    activeSanctions={report.activeSanctions.map((s) => s.kind)}
                    allowDismiss={waiting}
                    allowClaim={report.status === "open"}
                  />
                </>
              ) : (
                <p className={styles.subtle}>This report is closed. Nothing else applies.</p>
              )}
            </section>
          ) : (
            <p className="metric-definition">Your role can read reports. Admins and super-admins act on them.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
