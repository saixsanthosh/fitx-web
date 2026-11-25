import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AnnouncementForm } from "@/components/announcement-form";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { announcementStatus, ANNOUNCEMENT_TONE_LABELS } from "@/lib/announcement-input";
import { getAnnouncement } from "@/lib/data/announcements";
import { noticeWords, pageNotice } from "@/lib/notice";
import { MIGRATIONS } from "@/lib/schema";
import { formatIstDateTime, isoToIstInput } from "@/lib/time";
import { setAnnouncementStatus } from "../actions";

export const metadata: Metadata = { title: "Announcement" };

const notices: Record<string, { tone: "success" | "error"; text: string }> = {
  saved: { tone: "success", text: "Saved and recorded in the audit log." },
  published: { tone: "success", text: "Published. Signed-in people see it in the app during its time window." },
  draft: { tone: "success", text: "Back to draft. It no longer shows in the app." },
  archived: { tone: "success", text: "Archived. It no longer shows in the app." },
  invalid: { tone: "error", text: "That status is not valid." },
  forbidden: { tone: "error", text: "Your role cannot change announcements." },
  migration: { tone: "error", text: `This needs migration ${MIGRATIONS.announcements}.` },
  configuration: { tone: "error", text: "Server data access is not configured." },
  failed: { tone: "error", text: "The change did not complete. The server log has the details." },
};

function StatusButton({ id, status, label, primary = false }: { id: string; status: string; label: string; primary?: boolean }) {
  return (
    <form action={setAnnouncementStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={primary ? "primary-button" : "quiet-button"} type="submit">{label}</button>
    </form>
  );
}

export default async function AnnouncementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireAdmin("announcements.manage");
  const { id } = await params;
  const { notice } = await searchParams;
  const result = await getAnnouncement(id);
  if (result.state === "not_found") notFound();
  const back = <Link href="/announcements" className="text-link back-link"><ArrowLeft aria-hidden="true" size={15} />Announcements</Link>;
  if (result.state !== "ready") return <div className="page-stack">{back}<ModuleState state={result.state} migration={MIGRATIONS.announcements} /></div>;

  const row = result.row;
  const status = announcementStatus(row);
  const opened = pageNotice(notice, actor.id);
  const message = opened?.code === "saved" && row.status === "published"
    ? { tone: "success" as const, text: "Saved and recorded in the audit log. Signed-in people see these changes from their next visit, during its time window." }
    : noticeWords(notices, opened);

  return (
    <div className="page-stack narrow-stack">
      {back}
      <div className="page-heading-row">
        <div><p className="eyebrow">Announcement</p><h1 className="break-anywhere">{row.title}</h1><p className="page-lede"><span className={`status-pill ${status.tone}`}><i />{status.text}</span>{row.createdBy ? ` Created by ${row.createdBy}.` : ""}{row.publishedAt ? ` First published ${formatIstDateTime(row.publishedAt)}.` : ""}{row.dismissals !== null ? ` Dismissed by ${row.dismissals.toLocaleString("en-IN")} ${row.dismissals === 1 ? "account" : "accounts"}.` : ""}</p></div>
      </div>
      {message && <p className={`inline-notice ${message.tone === "success" ? "notice-success" : "notice-error"}`} role="status">{message.text}</p>}

      <section className="table-panel form-panel" aria-label="Preview">
        <p className="eyebrow">Preview</p>
        <div className={`announcement-preview tone-${row.tone}`}>
          <strong>{row.title}</strong>
          <p>{row.body}</p>
          {row.linkUrl && row.linkLabel && <span className="preview-link">{row.linkLabel} → {row.linkUrl}</span>}
          <small>{ANNOUNCEMENT_TONE_LABELS[row.tone]}</small>
        </div>
        <div className="button-row">
          {row.status !== "published" && <StatusButton id={row.id} status="published" label="Publish" primary />}
          {row.status === "published" && <StatusButton id={row.id} status="draft" label="Back to draft" />}
          {row.status !== "archived" && <StatusButton id={row.id} status="archived" label="Archive" />}
        </div>
      </section>

      <section className="table-panel form-panel" aria-label="Edit">
        <h2>Edit</h2>
        <AnnouncementForm
          submitLabel={row.status === "published" ? "Save and update the live announcement" : "Save changes"}
          status={row.status}
          defaults={{
            id: row.id,
            title: row.title,
            body: row.body,
            tone: row.tone,
            linkUrl: row.linkUrl,
            linkLabel: row.linkLabel,
            startsAt: isoToIstInput(row.startsAt),
            endsAt: isoToIstInput(row.endsAt),
          }}
        />
      </section>
    </div>
  );
}
