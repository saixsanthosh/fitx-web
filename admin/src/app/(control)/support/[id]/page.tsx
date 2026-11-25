import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { PendingButton } from "@/components/pending-button";
import { ReplyForm } from "@/components/support/reply-form";
import { SUPPORT_NOTICES } from "@/components/support/support-notices";
import { requireAdmin } from "@/lib/admin-auth";
import { getSupportThread, markSupportRead } from "@/lib/data/support";
import { can } from "@/lib/roles";
import { noticeWords, pageNotice } from "@/lib/notice";
import { MIGRATIONS } from "@/lib/schema";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUSES,
} from "@/lib/support-catalog";
import { formatIstDateTime } from "@/lib/time";
import { updateRequest } from "../actions";

export const metadata: Metadata = { title: "Help request" };


export default async function SupportRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireAdmin("support.view");
  const { id } = await params;
  const { notice } = await searchParams;
  const result = await getSupportThread(id);
  if (result.state === "not_found") notFound();
  const back = <Link href="/support" className="text-link back-link"><ArrowLeft aria-hidden="true" size={15} />Inbox</Link>;
  if (result.state !== "ready") return <div className="page-stack">{back}<ModuleState state={result.state} migration={MIGRATIONS.support} /></div>;

  const thread = result.thread;
  // Opening the request marks it read (the database audits it when it was unread).
  await markSupportRead(thread.id);
  const message = noticeWords(SUPPORT_NOTICES, pageNotice(notice, actor.id));
  const mayReply = can(actor.role, "support.reply");

  return (
    <div className="page-stack">
      {back}
      <div className="page-heading-row"><div><p className="eyebrow">{SUPPORT_CATEGORY_LABELS[thread.category] ?? thread.category}</p><h1 className="break-anywhere">{thread.subject}</h1><p className="page-lede">From {thread.requesterEmail ?? "an account"} · {formatIstDateTime(thread.createdAt)}{thread.pagePath ? ` · sent from ${thread.pagePath}` : ""}</p></div></div>
      {message && <p className={`inline-notice ${message.tone === "success" ? "notice-success" : "notice-error"}`} role="status">{message.text}</p>}

      <div className="thread-layout">
        <section className="table-panel thread" aria-label="Conversation">
          <article className="thread-message thread-user">
            <header><strong>{thread.requesterEmail ?? "Customer"}</strong><time dateTime={thread.createdAt}>{formatIstDateTime(thread.createdAt)}</time></header>
            <p>{thread.body}</p>
          </article>
          {thread.messages.map((entry) => (
            <article key={entry.id} className={`thread-message ${entry.authorKind === "staff" ? "thread-staff" : "thread-user"}`}>
              <header><strong>{entry.authorKind === "staff" ? `FITX Support${entry.authorLabel ? ` (${entry.authorLabel})` : ""}` : (thread.requesterEmail ?? "Customer")}</strong><time dateTime={entry.createdAt}>{formatIstDateTime(entry.createdAt)}</time></header>
              <p>{entry.body}</p>
            </article>
          ))}
          {mayReply && <ReplyForm requestId={thread.id} />}
        </section>

        <aside className="table-panel side-panel" aria-label="Request details">
          <h2>Details</h2>
          {mayReply ? (
            <form action={updateRequest} className="stack-form">
              <input type="hidden" name="requestId" value={thread.id} />
              <input type="hidden" name="seenUpdatedAt" value={thread.updatedAt} />
              <label>Status<select name="status" defaultValue={thread.status}>{SUPPORT_STATUSES.map((status) => <option key={status} value={status}>{SUPPORT_STATUS_LABELS[status]}</option>)}</select></label>
              <label>Priority<select name="priority" defaultValue={thread.priority}>{SUPPORT_PRIORITIES.map((priority) => <option key={priority} value={priority}>{SUPPORT_PRIORITY_LABELS[priority]}</option>)}</select></label>
              <label>Assigned to<select name="assignee" defaultValue={thread.assignedTo ?? ""}>
                <option value="">Nobody</option>
                {thread.assignees.map((member) => <option key={member.operatorId} value={member.operatorId}>{member.username}</option>)}
                {/* The current assignee always stays selectable, so saving other details never drops them. */}
                {thread.assignedTo && !thread.assignees.some((member) => member.operatorId === thread.assignedTo) && (
                  <option value={thread.assignedTo}>{thread.assignedToLabel ?? thread.assignedTo.slice(0, 8)} (current assignee)</option>
                )}
              </select></label>
              <PendingButton className="quiet-button" pendingLabel="Saving…">Save</PendingButton>
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
