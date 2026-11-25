"use client";

import { useActionState, useId, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { moderateKept } from "@/app/(control)/explore/actions";
import { keepTyped } from "@/components/content/keep-typed";
import { FormResult } from "@/components/form-kit";
import { fieldAria } from "@/components/form-rules";
import { IDLE } from "@/lib/content/form";
import { ACTION_LABELS, REASON_LABELS, REPORT_REASONS, type ModerationAction, type ReportReason } from "@/lib/explore-rules";
import styles from "./explore.module.css";

/**
 * The actions on a report or an account that can be undone, one submit button each, with a reason and a note for
 * moderators. A refusal (someone else closed the report, the content is gone, a failure) comes back beside the buttons
 * and the reason and the note stay as typed (BUGS.md 63), so the moderator can act again without retyping; an action
 * that happened reloads the page with its result at the top. While one is sent, every button ignores a press but
 * keeps focus, and the pressed one shows that it is working.
 */
export function ReversibleActionsForm({ target, actions, defaultReason, allowClaim, allowDismiss }: {
  target: { reportId?: string; userId?: string };
  actions: readonly ModerationAction[];
  defaultReason?: ReportReason;
  allowClaim: boolean;
  allowDismiss: boolean;
}) {
  const [state, action, pending] = useActionState(moderateKept, IDLE);
  const [pressed, setPressed] = useState<ModerationAction | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const resultId = useId();
  const buttons: ModerationAction[] = [...actions, ...(allowClaim ? ["claim" as const] : []), ...(allowDismiss ? ["dismiss" as const] : [])];
  return (
    <form ref={formRef} action={action} onSubmit={keepTyped(action)} className={`stack-form ${styles.compact}`}>
      {target.reportId && <input type="hidden" name="reportId" value={target.reportId} />}
      {target.userId && <input type="hidden" name="userId" value={target.userId} />}
      {actions.some((value) => value !== "unhide") && (
        <label>
          Reason (the member and the audit log see only its name)
          <select name="reason" defaultValue={defaultReason ?? "other"} {...fieldAria(state, "reason", resultId)}>
            {REPORT_REASONS.map((reason) => <option key={reason} value={reason}>{REASON_LABELS[reason]}</option>)}
          </select>
        </label>
      )}
      <label>Note for moderators (optional, never shown to the member)<textarea name="note" maxLength={1000} rows={2} {...fieldAria(state, "note", resultId)} /></label>
      <div className={styles.buttons}>
        {buttons.map((value) => (
          <button
            key={value}
            type="submit"
            name="action"
            value={value}
            className={value === "hide" ? "primary-button" : "quiet-button"}
            aria-disabled={pending}
            onClick={(event) => {
              if (pending) event.preventDefault();
              else setPressed(value);
            }}
          >
            {pending && pressed === value && <LoaderCircle aria-hidden="true" className="spin" size={16} />}
            <span>{ACTION_LABELS[value]}</span>
          </button>
        ))}
      </div>
      <FormResult id={resultId} state={state} formRef={formRef} />
    </form>
  );
}
