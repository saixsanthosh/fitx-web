"use client";

import { useActionState, useId, useRef } from "react";
import { replyToRequest } from "@/app/(control)/support/actions";
import { keepTyped } from "@/components/content/keep-typed";
import { BusyButton, FormResult } from "@/components/form-kit";
import { fieldAria } from "@/components/form-rules";
import { IDLE } from "@/lib/content/form";
import { SUPPORT_REPLY_MAX, SUPPORT_STATUS_LABELS, SUPPORT_STATUSES } from "@/lib/support-catalog";

/**
 * Reply as FITX Support. A refusal (a reply of only spaces, a database failure) comes back beside Send reply and the
 * reply stays as typed, so a long answer is never lost; a reply sent reloads the conversation.
 */
export function ReplyForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(replyToRequest, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const resultId = useId();
  return (
    <form ref={formRef} action={action} onSubmit={keepTyped(action)} className="stack-form reply-form">
      <input type="hidden" name="requestId" value={requestId} />
      <label>Reply as FITX Support<textarea name="body" required maxLength={SUPPORT_REPLY_MAX} rows={5} placeholder="The person sees this on their Help page. Your name and email are not shown to them." {...fieldAria(state, "body", resultId)} /></label>
      <div className="form-row">
        <label>Then set the status to<select name="status" defaultValue="waiting_on_user" {...fieldAria(state, "status", resultId)}>{SUPPORT_STATUSES.map((status) => <option key={status} value={status}>{SUPPORT_STATUS_LABELS[status]}</option>)}</select></label>
        <BusyButton pending={pending} className="primary-button" pendingLabel="Sending…">Send reply</BusyButton>
      </div>
      <FormResult id={resultId} state={state} pending={pending} formRef={formRef} />
    </form>
  );
}
