import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PageHead, Panel, consoleStyles as ui } from "@/components/console/ui";
import { ModuleState } from "@/components/module-state";
import { NoticeForm } from "@/components/notifications/notice-form";
import { recipientsFromQuery } from "@/components/notifications/notice-rules";
import styles from "@/components/notifications/notifications.module.css";
import { ADMIN_OPS_MIGRATION } from "@/components/settings/settings-rules";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { announcementStatus, ANNOUNCEMENT_TONE_LABELS } from "@/lib/announcement-input";
import { listAnnouncements } from "@/lib/data/announcements";
import { listNoticeHistory } from "@/lib/data/notifications";
import { MIGRATIONS } from "@/lib/schema";
import { firstParam } from "@/lib/search-params";
import { formatIstDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("notifications.send");
  const params = await searchParams;
  const canEveryone = hasPermission(actor, "announcements.manage");
  const [history, announcements] = await Promise.all([listNoticeHistory(30), canEveryone ? listAnnouncements() : Promise.resolve(null)]);

  return (
    <div className="page-stack">
      <PageHead eyebrow="Notifications" title="Send" meta="Shown in the app's banner until dismissed" />
      <Panel title="New notice" className={ui.rise}>
        <NoticeForm canEveryone={canEveryone} canUseEmails={hasPermission(actor, "people.view")} recipients={recipientsFromQuery(firstParam(params.to))} />
      </Panel>

      <div className={ui.columns}>
        <Panel title="To chosen accounts" hint="History" className={ui.onScroll}>
          {history.state === "ready" ? (
            history.batches.length ? history.batches.map((batch) => (
              <article key={batch.batchId} className={styles.historyItem}>
                <div className={styles.historyTop}><strong>{batch.title}</strong><span className={styles.historyMeta}>{formatIstDateTime(batch.sentAt)}</span></div>
                <span className={styles.historyMeta}>{batch.recipients.toLocaleString("en-IN")} {batch.recipients === 1 ? "account" : "accounts"} · {batch.dismissed.toLocaleString("en-IN")} dismissed · {ANNOUNCEMENT_TONE_LABELS[batch.tone as keyof typeof ANNOUNCEMENT_TONE_LABELS] ?? batch.tone}{batch.operator ? ` · ${batch.operator}` : ""}</span>
                <svg className={styles.meter} viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label={`${batch.dismissed} of ${batch.recipients} dismissed`}>
                  <rect className={styles.meterFill} width={batch.recipients ? (batch.dismissed / batch.recipients) * 100 : 0} height={6} />
                </svg>
              </article>
            )) : <p className="metric-definition">Nothing sent yet.</p>
          ) : <ModuleState state={history.state} migration={ADMIN_OPS_MIGRATION} />}
        </Panel>

        {announcements && (
          <Panel title="To everyone" hint="Announcements" className={ui.onScroll} action={<Link className="text-link" href="/announcements">Manage<ArrowUpRight aria-hidden="true" size={15} /></Link>}>
            {announcements.state === "ready" ? (
              announcements.rows.length ? announcements.rows.slice(0, 8).map((row) => {
                const status = announcementStatus(row);
                return (
                  <article key={row.id} className={styles.historyItem}>
                    <div className={styles.historyTop}><Link className="row-link" href={`/announcements/${row.id}`}><strong>{row.title}</strong></Link><span className={`status-pill ${status.tone}`}><i />{status.text}</span></div>
                    <span className={styles.historyMeta}>{row.publishedAt ? `Published ${formatIstDateTime(row.publishedAt)}` : "Not published"}{row.dismissals !== null ? ` · ${row.dismissals.toLocaleString("en-IN")} dismissed` : ""}</span>
                  </article>
                );
              }) : <p className="metric-definition">No announcements yet.</p>
            ) : <ModuleState state={announcements.state} migration={MIGRATIONS.announcements} />}
          </Panel>
        )}
      </div>
    </div>
  );
}
