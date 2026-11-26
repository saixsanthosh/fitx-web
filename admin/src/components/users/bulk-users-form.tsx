"use client";

import { useActionState, useId, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { bulkUsers } from "@/app/(control)/users/actions";
import { keepTyped } from "@/components/content/keep-typed";
import { FormResult } from "@/components/form-kit";
import { fieldAria } from "@/components/form-rules";
import { IDLE } from "@/lib/content/form";
import { SelectionCount } from "./select-all";
import styles from "./users.module.css";

type Choice = "suspend" | "notice";

/**
 * The Users list's selection form (each row's box joins it with form="bulk-users"): Suspend selected, with a reason and
 * a tick, and Send notice to selected. A refusal (no row or too many rows ticked, the reason, the tick, the audit log,
 * Supabase refusing every account) comes back beside the buttons, and the reason, the tick and the ticked rows stay
 * (BUGS.md 63); the reason or the tick is marked and focused when it is the cause, else the message is. A suspension
 * reloads the list with its result at the top; a notice opens Notifications. While one is sent, both buttons ignore a
 * press but keep focus, and the pressed one shows that it is working.
 */
export function BulkUsersForm({ here, canSuspend, canNotify, max }: { here: string; canSuspend: boolean; canNotify: boolean; max: number }) {
  const [state, action, pending] = useActionState(bulkUsers, IDLE);
  const [pressed, setPressed] = useState<Choice | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const resultId = useId();
  // The pressed button's "do" goes with the form's data (keepTyped), so the action knows which was meant.
  const submit = (choice: Choice, className: string, label: string, skipChecks = false) => (
    <button
      type="submit"
      name="do"
      value={choice}
      className={className}
      formNoValidate={skipChecks}
      aria-disabled={pending}
      onClick={(event) => {
        if (pending) event.preventDefault();
        else setPressed(choice);
      }}
    >
      {pending && pressed === choice && <LoaderCircle aria-hidden="true" className="spin" size={16} />}
      <span>{label}</span>
    </button>
  );
  return (
    <form ref={formRef} id="bulk-users" className={styles.bulk} action={action} onSubmit={keepTyped(action)} aria-label="Selected accounts">
      <input type="hidden" name="return" value={here} />
      <div className={styles.bulkHead}><SelectionCount form="bulk-users" max={max} /></div>
      {canSuspend && (
        <div className={styles.bulkRow}>
          <input type="text" name="reason" required minLength={3} maxLength={200} placeholder="Reason, kept in the audit log" aria-label="Reason for suspending" {...fieldAria(state, "reason", resultId)} />
          <label className="check-label"><input type="checkbox" name="confirm" value="yes" required {...fieldAria(state, "confirm", resultId)} />Suspend and sign out</label>
          <div className={styles.bulkButtons}>{submit("suspend", "danger-button", "Suspend selected")}</div>
        </div>
      )}
      {/* A notice needs no reason or tick, so the browser's own checks are skipped for it. */}
      {canNotify && <div className={styles.bulkButtons}>{submit("notice", "quiet-button", "Send notice to selected", true)}</div>}
      <FormResult id={resultId} state={state} pending={pending} formRef={formRef} />
    </form>
  );
}
