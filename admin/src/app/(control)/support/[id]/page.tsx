import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { getSupportThread } from "@/lib/data/support";
import { can } from "@/lib/roles";
import { MIGRATIONS } from "@/lib/schema";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_REPLY_MAX,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUSES,
} from "@/lib/support-catalog";
import { formatIstDateTime } from "@/lib/time";
import { replyToRequest, updateRequest } from "../actions";

export const metadata: Metadata = { title: "Help request" };

const notices: Record<string, { tone: "success" | "error"; text: string }> = {
  replied: { tone: "success", text: "Reply sent. The person sees it on their Help page." },
  updated: { tone: "success", text: "Request updated and recorded in the audit log." },
  reply_length: { tone: "error", text: `A reply needs 1 to ${SUPPORT_REPLY_MAX} characters.` },
  invalid: { tone: "error", text: "Check the status, priority and assignee." },
  assignee: { tone: "error", text: "The assignee must be an active Admin member with support access." },
  forbidden: { tone: "error", text: "Your role cannot change help requests." },
  migration: { tone: "error", text: `This needs migration ${MIGRATIONS.support}.` },
  configuration: { tone: "error", text: "Server data access is not configured." },
  failed: { tone: "error", text: "The change did not complete. The server log has the details." },
};

export default async function SupportRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireAdmin("support.view");
  const { id } = await params;
  const { notice } = await searchParams;
  const result = await getSupportThread(id);
  if (result.state === "not_found") notFound();
  const back = <Link href="/support" className="text-link back-link"><ArrowLeft aria-hidden="true" size={15} />Support queue</Link>;
  if (result.state !== "ready") return <div className="page-stack">{back}<ModuleState state={result.state} migration={MIGRATIONS.support} /></div>;

  const thread = result.thread;
  const message = notice ? notices[notice] : undefined;
  const mayReply = can(actor.role, "support.reply");

  return (
    <div className="page-stack">
      {back}
      <div className="page-heading-row"><div><p className="eyebrow">{SUPPORT_CATEGORY_LABELS[thread.category].toUpperCase()}</p><h1 className="break-anywhere">{thread.subject}</h1><p className="page-lede">From {thread.requesterEmail ?? "an account"} · {formatIstDateTime(thread.createdAt)}{thread.pagePath ? ` · sent from ${thread.pagePath}` : ""}</p></div><span className="page-heading-icon"><MessagesSquare aria-hidden="true" size={20} /></span></div>
      {message && <p className={`inline-notice ${message.tone === "success" ? "notice-success" : "notice-error"}`} role="status">{message.text}</p>}

      <div className="thread-layout">
        <section className="table-panel thread" aria-label="Conversation">
          <article className="thread-message thread-user">
            <header><strong>{thread.requesterEmail ?? "Customer"}</strong><time dateTime={thread.createdAt}>{formatIstDateTime(thread.createdAt)}</time></header>
            <p>{thread.body}</p>
          </article>
          {thread.messages.map((entry) => (
            <article key={entry.id} className={`thread-message ${entry.authorKind === "staff" ? "thread-staff" : "thread-user"}`}>
              <header><strong>{entry.authorKind === "staff" ? `FITX Support${entry.authorEmail ? ` (${entry.authorEmail})` : ""}` : (thread.requesterEmail ?? "Customer")}</strong><time dateTime={entry.createdAt}>{formatIstDateTime(entry.createdAt)}</time></header>
              <p>{entry.body}</p>
            </article>
          ))}
          {mayReply && (
            <form action={replyToRequest} className="stack-form reply-form">
              <input type="hidden" name="requestId" value={thread.id} />
              <label>Reply as FITX Support<textarea name="body" required maxLength={SUPPORT_REPLY_MAX} rows={5} placeholder="The person sees this on their Help page. Your name and email are not shown to them." /></label>
              <div className="form-row">
                <label>Then set the status to<select name="status" defaultValue="waiting_on_user">{SUPPORT_STATUSES.map((status) => <option key={status} value={status}>{SUPPORT_STATUS_LABELS[status]}</option>)}</select></label>
                <button className="primary-button" type="submit">Send reply</button>
              </div>
            </form>
          )}
        </section>

        <aside className="table-panel side-panel" aria-label="Request details">
          <h2>Details</h2>
          {mayReply ? (
            <form action={updateRequest} className="stack-form">
              <input type="hidden" name="requestId" value={thread.id} />
              <label>Status<select name="status" defaultValue={thread.status}>{SUPPORT_STATUSES.map((status) => <option key={status} value={status}>{SUPPORT_STATUS_LABELS[status]}</option>)}</select></label>
              <label>Priority<select name="priority" defaultValue={thread.priority}>{SUPPORT_PRIORITIES.map((priority) => <option key={priority} value={priority}>{SUPPORT_PRIORITY_LABELS[priority]}</option>)}</select></label>
              <label>Assigned to<select name="assignee" defaultValue={thread.assignedTo ?? ""}><option value="">Nobody</option>{thread.assignees.map((member) => <option key={member.userId} value={member.userId}>{member.email ?? member.userId.slice(0, 8)}</option>)}</select></label>
              <button className="quiet-button" type="submit">Save</button>
            </form>
          ) : (
            <dl className="detail-list"><div className="detail-field"><dt>Status</dt><dd>{SUPPORT_STATUS_LABELS[thread.status]}</dd></div><div className="detail-field"><dt>Priority</dt><dd>{SUPPORT_PRIORITY_LABELS[thread.priority]}</dd></div></dl>
          )}
          {can(actor.role, "people.view") && <Link className="text-link" href={`/users/${thread.requesterId}`}>Open the account</Link>}
        </aside>
      </div>
    </div>
  );
}
