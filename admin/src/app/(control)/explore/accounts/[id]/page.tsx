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
import { getAccountRecord } from "@/lib/data/explore";
import { signedLink } from "@/lib/data/explore-evidence";
import { ACTION_LABELS, EXPLORE_MIGRATION, REASON_LABELS, SANCTION_LABELS, STATUS_LABELS, TARGET_LABELS, isAction, type ModerationAction } from "@/lib/explore-rules";
import { firstParam } from "@/lib/search-params";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { formatIstDate, formatIstDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Explore account" };

const count = (value: number | null) => (value === null ? "–" : value.toLocaleString("en-IN"));

export default async function ExploreAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("explore.view");
  const { id } = await params;
  const query = await searchParams;
  const back = <Link href="/explore" className="text-link back-link"><ArrowLeft aria-hidden="true" size={15} />Queue</Link>;
  const result = await getAccountRecord(id);
  if (result.state === "not_found") notFound();
  if (result.state !== "ready") return <div className="page-stack">{back}<ModuleState state={result.state} migration={EXPLORE_MIGRATION} /></div>;
  const account = result.account;
  const admin = createAdminSupabase();
  const avatar = admin && account.profile?.avatarPath ? await signedLink(admin, account.profile.avatarPath) : null;
  const notice = exploreNotice(firstParam(query.notice));
  const moderator = hasPermission(actor, "explore.moderate");
  const active = account.sanctions.filter((sanction) => sanction.active);
  const memberActions: ModerationAction[] = account.profile ? ["warn", ...(account.profile.avatarPath ? (["clear_avatar"] as const) : []), ...(account.profile.bio ? (["clear_bio"] as const) : [])] : ["warn"];
  const name = account.profile ? `@${account.profile.username}` : "Member without an Explore profile";

  return (
    <div className="page-stack">
      {back}
      <div className="page-heading-row">
        <div className={styles.identity}>
          <span className={styles.avatar}>
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element -- a 300-second signed Storage link
              <img src={avatar} alt="" />
            ) : <span className={styles.initial} aria-hidden="true">{(account.profile?.displayName ?? "?").slice(0, 1).toUpperCase()}</span>}
          </span>
          <div>
            <p className="eyebrow">Explore account</p>
            <h1 className="break-anywhere">{name}</h1>
            <p className="page-lede">
              {account.profile ? `${account.profile.displayName} · ${account.profile.isPrivate ? "Private" : "Public"} · on Explore since ${formatIstDate(account.profile.createdAt)}` : "No Explore profile"}
            </p>
          </div>
        </div>
        {hasPermission(actor, "people.view") && <Link className="quiet-button" href={`/users/${account.userId}`}>Open the account</Link>}
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className={styles.layout}>
        <div className={styles.stack}>
          <dl className={`${styles.numbers} ${ui.rise}`}>
            <div><dt>Posts</dt><dd>{count(account.posts.total)}</dd></div>
            <div><dt>Hidden or limited</dt><dd>{account.posts.hidden === null || account.posts.limited === null ? "–" : (account.posts.hidden + account.posts.limited).toLocaleString("en-IN")}</dd></div>
            <div><dt>Reports about them</dt><dd>{count(account.reportsAgainstTotal)}</dd></div>
            <div><dt>Reports they sent</dt><dd>{count(account.reportsMade)}</dd></div>
          </dl>

          <Panel title="Profile" hint="As other members see it" className={ui.onScroll}>
            {account.profile ? (
              <dl className="detail-list">
                <div className="detail-field"><dt>Bio</dt><dd>{account.profile.bio || "None"}</dd></div>
                <div className="detail-field"><dt>Date of birth</dt><dd>{account.profile.birthDateAddedAt ? `Added by the member after joining Explore, on ${formatIstDate(account.profile.birthDateAddedAt)}` : "Not added after joining Explore"}</dd></div>
              </dl>
            ) : <p className="metric-definition">This member has not made an Explore profile.</p>}
          </Panel>

          <Panel title="Reports about them" flush className={ui.onScroll}>
            {account.reportsAgainst.length ? (
              <ul className={styles.list}>
                {account.reportsAgainst.map((report) => (
                  <li key={report.id} className={styles.item}>
                    <Link className={`${styles.link} ${styles.plain}`} href={`/explore/reports/${report.id}`}>
                      <span className={styles.top}>
                        <span className={styles.title}>{TARGET_LABELS[report.targetType]}: {REASON_LABELS[report.reason]}</span>
                        <time className={styles.when} dateTime={report.createdAt}>{formatIstDateTime(report.createdAt)}</time>
                      </span>
                      <span className={styles.meta}>{STATUS_LABELS[report.status]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <div className="empty-state"><h3>No reports</h3><p>Nobody has reported this member.</p></div>}
          </Panel>

          {account.history.length > 0 && (
            <Panel title="What moderators did" className={ui.onScroll}>
              <ul className={styles.history}>
                {account.history.map((entry) => (
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

        <aside className={styles.stack} aria-label="Suspensions and actions">
          <section className="table-panel side-panel">
            <h2>Suspensions</h2>
            {account.sanctions.length ? (
              <ul className={styles.history}>
                {account.sanctions.map((sanction) => (
                  <li key={sanction.id}>
                    <span className={sanction.active ? undefined : styles.reversed}>
                      {SANCTION_LABELS[sanction.kind]} · {REASON_LABELS[sanction.reason as keyof typeof REASON_LABELS] ?? sanction.reason}
                      {sanction.until ? ` · until ${formatIstDate(sanction.until)}` : " · until lifted"}
                      {sanction.operator ? ` · ${sanction.operator}` : ""}
                    </span>
                    <span className={`status-pill ${sanction.active ? "status-danger" : "status-neutral"}`}><i />{sanction.active ? "Active" : sanction.liftedAt ? "Lifted" : "Ended"}</span>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.subtle}>Never suspended.</p>}
          </section>
          {moderator ? (
            <section className={`table-panel ${styles.actions}`} aria-labelledby="account-actions-title">
              <h2 id="account-actions-title">Actions</h2>
              <p className={styles.subtle}>These close any open reports about the account and go on the audit log.</p>
              <ModerationForms
                target={{ userId: account.userId }}
                actions={memberActions}
                allowSuspend
                activeSanctions={[...new Set(active.map((sanction) => sanction.kind))]}
                allowDismiss={false}
                allowClaim={false}
              />
            </section>
          ) : <p className="metric-definition">Your role can read this record. Admins and super-admins act on it.</p>}
        </aside>
      </div>
    </div>
  );
}
