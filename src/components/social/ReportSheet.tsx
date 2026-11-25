"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/Sheet";
import { SOCIAL_LIMITS, socialApi, toSocialError, type ReportReason, type ReportTarget } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import { useNotice } from "./useNotice";
import styles from "./Explore.module.css";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Bullying or harassment" },
  { value: "hate", label: "Hate speech" },
  { value: "nudity", label: "Nudity or sexual content" },
  { value: "violence", label: "Violence or threats" },
  { value: "self_harm", label: "Self-harm or eating disorder" },
  { value: "false_information", label: "False health information" },
  { value: "scam", label: "Scam or fraud" },
  { value: "other", label: "Something else" },
];

const NOUN: Record<ReportTarget, string> = {
  post: "post", comment: "comment", account: "account", story: "story", message: "message", community: "community", challenge: "challenge",
};

export const REPORT_SENT = "Report sent. Thank you.";

/**
 * Reports a post, comment, account, story, message, community or challenge to FITX's moderators. The member who posted
 * it is not told who reported. A failure is said inside the sheet (D6). The thanks is a toast once the sheet has
 * closed, unless the host is itself a dialog that stays open (the story viewer), which says it with `onSent`.
 */
export function ReportSheet({ db, target, onClose, onSent }: { db: Db; target: { type: ReportTarget; id: string } | null; onClose: () => void; onSent?: (text: string) => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const { notice, show, clear } = useNotice();
  const close = () => {
    setReason(null);
    setDetails("");
    clear();
    onClose();
  };
  async function send() {
    if (!target || !reason || busy) return;
    setBusy(true);
    clear();
    try {
      await socialApi.report(db, target.type, target.id, reason, details.trim() || null);
      close();
      if (onSent) onSent(REPORT_SENT);
      else toast.success(REPORT_SENT);
    } catch (error) {
      show("error", toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={target !== null}
      onClose={close}
      title={`Report ${target ? NOUN[target.type] : ""}`}
      description="FITX reviews reports. They are not shared with the person you report."
      notice={notice}
      footer={<button type="button" className="fitx-button w-full aria-disabled:opacity-60" disabled={!reason} aria-disabled={busy || undefined} onClick={() => void send()}>{busy ? "Sending…" : "Send report"}</button>}
    >
      <fieldset className={styles.radioList}>
        <legend className="sr-only">Reason</legend>
        {REPORT_REASONS.map((item) => (
          <label key={item.value} className="fitx-choice">
            <input type="radio" name="report-reason" value={item.value} checked={reason === item.value} onChange={() => setReason(item.value)} />
            <span className="fitx-choice__box">{item.label}</span>
          </label>
        ))}
      </fieldset>
      <div className={`${styles.field} mt-4`}>
        <label className={styles.label} htmlFor="report-details">Details (optional)</label>
        <textarea id="report-details" className="fitx-field" maxLength={SOCIAL_LIMITS.reportDetailsChars} value={details} onChange={(event) => setDetails(event.target.value)} />
      </div>
    </Sheet>
  );
}
