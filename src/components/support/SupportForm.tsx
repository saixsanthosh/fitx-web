"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Send } from "lucide-react";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_ERROR_MESSAGES,
  SUPPORT_LIMITS,
  validateSupportRequest,
} from "@/components/support/support-rules";

/** The Help page form. Sends to /api/support, which takes the account from the session. */
export function SupportForm({ fromPath }: { fromPath?: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = { category: data.get("category"), subject: data.get("subject"), body: data.get("body"), pagePath: fromPath ?? null };
    const checked = validateSupportRequest(payload);
    if (!checked.ok) {
      setStatus({ tone: "danger", text: checked.error });
      return;
    }
    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) {
        setStatus({ tone: "danger", text: result.message ?? SUPPORT_ERROR_MESSAGES[result.error ?? "failed"] ?? SUPPORT_ERROR_MESSAGES.failed });
        return;
      }
      form.reset();
      setStatus({ tone: "success", text: "Thanks, your message is with the FITX team. Replies appear below on this page." });
      router.refresh();
    } catch {
      setStatus({ tone: "danger", text: SUPPORT_ERROR_MESSAGES.failed });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="fitx-panel space-y-4 p-5" aria-labelledby="help-form-title">
      <div>
        <h2 id="help-form-title" className="text-base font-semibold text-fitx-text">Send us a message</h2>
        <p className="mt-1 text-sm text-fitx-text-secondary">Ask a question, report a problem or share an idea. A person on the FITX team reads every message.</p>
      </div>
      <label className="block text-sm font-medium text-fitx-text">
        What is it about?
        <select name="category" defaultValue="question" className="fitx-field mt-1.5">
          {SUPPORT_CATEGORIES.map((category) => <option key={category} value={category}>{SUPPORT_CATEGORY_LABELS[category]}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium text-fitx-text">
        Subject
        <input name="subject" required minLength={SUPPORT_LIMITS.subjectMin} maxLength={SUPPORT_LIMITS.subjectMax} className="fitx-field mt-1.5" placeholder="A few words, for example: Workout timer stops" />
      </label>
      <label className="block text-sm font-medium text-fitx-text">
        Message
        <textarea name="body" required minLength={SUPPORT_LIMITS.bodyMin} maxLength={SUPPORT_LIMITS.bodyMax} rows={6} className="fitx-field mt-1.5 min-h-32 py-3" placeholder="What happened, and what did you expect? Please leave out passwords and health details we do not need." />
      </label>
      {status && <p role={status.tone === "danger" ? "alert" : "status"} className={`fitx-alert ${status.tone === "danger" ? "fitx-alert-danger" : "fitx-alert-success"}`}>{status.text}</p>}
      <button type="submit" disabled={pending} className="fitx-button min-h-11 px-5">
        {pending ? <LoaderCircle aria-hidden="true" size={17} className="animate-spin" /> : <Send aria-hidden="true" size={17} />}
        <span>{pending ? "Sending…" : "Send message"}</span>
      </button>
    </form>
  );
}
