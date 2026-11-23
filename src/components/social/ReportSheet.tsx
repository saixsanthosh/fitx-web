"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/Sheet";
import { SOCIAL_LIMITS, socialApi, toSocialError, type ReportReason, type ReportTarget } from "@/lib/social";
import type { Db } from "@/lib/social/api";
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

const NOUN: Record<ReportTarget, string> = { post: "post", comment: "comment", account: "account" };

/** Reports a post, comment or account to FITX's moderators. The member who posted it is not told who reported. */
export function ReportSheet({ db, target, onClose }: { db: Db; target: { type: ReportTarget; id: string } | null; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => {
    setReason(null);
    setDetails("");
    onClose();
  };
  async function send() {
    if (!target || !reason) return;
    setBusy(true);
    try {
      await socialApi.report(db, target.type, target.id, reason, details.trim() || null);
      toast.success("Report sent. Thank you.");
      close();
    } catch (error) {
      toast.error(toSocialError(error).message);
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
      footer={<button type="button" className="fitx-button w-full" disabled={!reason || busy} onClick={() => void send()}>{busy ? "Sending…" : "Send report"}</button>}
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
