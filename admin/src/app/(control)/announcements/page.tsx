import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHead } from "@/components/console/ui";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { announcementStatus, ANNOUNCEMENT_TONE_LABELS } from "@/lib/announcement-input";
import { listAnnouncements } from "@/lib/data/announcements";
import { MIGRATIONS } from "@/lib/schema";
import { formatIstDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  await requireAdmin("announcements.manage");
  const result = await listAnnouncements();
  return (
    <div className="page-stack">
      <PageHead eyebrow="Notifications" title="Announcements" meta="Banners for every signed-in member" actions={<Link className="primary-button" href="/announcements/new"><Plus aria-hidden="true" size={16} />New announcement</Link>} />
      {result.state === "ready" ? (
        <section className="table-panel" aria-label="Announcements">
          {result.rows.length ? <div className="table-scroll"><table><thead><tr><th>Announcement</th><th>Status</th><th>Shows (IST)</th><th>Dismissed by</th><th>Created by</th></tr></thead><tbody>
            {result.rows.map((row) => {
              const status = announcementStatus(row);
              return <tr key={row.id}>
                <td><Link className="row-link" href={`/announcements/${row.id}`}><strong>{row.title}</strong><small className="table-subline">{ANNOUNCEMENT_TONE_LABELS[row.tone]}</small></Link></td>
                <td><span className={`status-pill ${status.tone}`}><i />{status.text}</span></td>
                <td>{row.startsAt ? formatIstDateTime(row.startsAt) : "When published"}{" → "}{row.endsAt ? formatIstDateTime(row.endsAt) : "until archived"}</td>
                <td>{row.dismissals === null ? "—" : `${row.dismissals.toLocaleString("en-IN")} accounts`}</td>
                <td>{row.createdByEmail ?? "—"}</td>
              </tr>;
            })}
          </tbody></table></div> : <div className="empty-state"><h3>No announcements yet</h3><p>Write one, check the preview, then publish.</p></div>}
        </section>
      ) : <ModuleState state={result.state} migration={MIGRATIONS.announcements} />}
    </div>
  );
}
