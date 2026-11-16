"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { SUPPORT_CATEGORY_LABELS, SUPPORT_ERROR_MESSAGES, SUPPORT_LIMITS, SUPPORT_STATUS_LABELS, type SupportCategory } from "@/components/support/support-rules";

export type SupportThreadView = {
  id: string;
  category: SupportCategory;
  subject: string;
  body: string;
  status: string;
  createdAt: string;
  messages: Array<{ id: string; fromTeam: boolean; body: string; createdAt: string }>;
};

// Times are shown in India Standard Time with the zone label, the same as the FITX team sees them in
// Admin. The zone is set explicitly so the server (UTC on Vercel) and the browser print the same time.
const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
  timeZoneName: "short",
});

/** Date and time in IST, for example "17 Nov 2026, 1:35 am IST". Browsers can space "am" differently from the server; React keeps the server text. */
function When({ value }: { value: string }) {
  const date = new Date(value);
  return <time dateTime={value} suppressHydrationWarning>{Number.isNaN(date.valueOf()) ? "" : dateTime.format(date)}</time>;
}

function ReplyForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/support/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, body }) });
      const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) {
        setError(result.message ?? SUPPORT_ERROR_MESSAGES[result.error ?? "failed"] ?? SUPPORT_ERROR_MESSAGES.failed);
        return;
      }
      form.reset();
      router.refresh();
    } catch {
      setError(SUPPORT_ERROR_MESSAGES.failed);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <label className="block text-sm font-medium text-fitx-text">
        Reply
        <textarea name="body" required maxLength={SUPPORT_LIMITS.replyMax} rows={3} className="fitx-field mt-1.5 min-h-20 py-2.5" />
      </label>
      {error && <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>}
      <button type="submit" disabled={pending} className="fitx-button fitx-button-secondary min-h-10 px-4 text-sm">
        {pending && <LoaderCircle aria-hidden="true" size={16} className="animate-spin" />}
        <span>{pending ? "Sending…" : "Send reply"}</span>
      </button>
    </form>
  );
}

/** The person's own Help requests, newest activity first, with replies from the FITX team. */
export function SupportThreads({ threads, canReply }: { threads: SupportThreadView[]; canReply: boolean }) {
  if (!threads.length) return null;
  return (
    <section className="space-y-3" aria-labelledby="help-history-title">
      <h2 id="help-history-title" className="text-base font-semibold text-fitx-text">Your messages</h2>
      {threads.map((thread) => (
        <details key={thread.id} className="fitx-panel p-4" open={thread.status === "waiting_on_user"}>
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-fitx-text">{thread.subject}</span>
              <span className="block text-xs text-fitx-text-secondary">{SUPPORT_CATEGORY_LABELS[thread.category]} · <When value={thread.createdAt} /></span>
            </span>
            <span className="rounded-full border border-fitx-border px-2.5 py-1 text-xs font-medium text-fitx-text-secondary">{SUPPORT_STATUS_LABELS[thread.status] ?? thread.status}</span>
          </summary>
          <ol className="mt-4 space-y-3 border-t border-fitx-divider pt-4">
            <li>
              <p className="text-xs font-semibold text-fitx-text-secondary">You · <When value={thread.createdAt} /></p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fitx-text">{thread.body}</p>
            </li>
            {thread.messages.map((message) => (
              <li key={message.id} className={message.fromTeam ? "rounded-lg border border-fitx-border bg-fitx-surface-variant p-3" : ""}>
                <p className="text-xs font-semibold text-fitx-text-secondary">{message.fromTeam ? "FITX team" : "You"} · <When value={message.createdAt} /></p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fitx-text">{message.body}</p>
              </li>
            ))}
          </ol>
          {canReply && thread.status !== "closed" && <ReplyForm requestId={thread.id} />}
        </details>
      ))}
    </section>
  );
}
