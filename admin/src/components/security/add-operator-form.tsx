"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { addOperator } from "@/app/(control)/access-control/actions";
import { keepTyped } from "@/components/content/keep-typed";
import { BusyButton, FormResult } from "@/components/form-kit";
import { clearPasswords, fieldAria } from "@/components/form-rules";
import { IDLE } from "@/lib/content/form";
import { ADMIN_ROLES, ROLE_LABELS } from "@/lib/roles";

/**
 * Add operator. A refusal (a taken or reserved username, a weak password, a failure) comes back beside the button with
 * the username and role kept as typed (BUGS.md 63), the field it is about marked and focused; the temporary password is
 * emptied after every refusal, never kept. An operator added reloads the page with the result at the top.
 */
export function AddOperatorForm({ minPasswordLength }: { minPasswordLength: number }) {
  const [state, action, pending] = useActionState(addOperator, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const resultId = useId();
  useEffect(() => {
    if (state.status === "error") clearPasswords(formRef.current);
  }, [state]);
  return (
    <form ref={formRef} action={action} onSubmit={keepTyped(action)} className="member-form">
      <label>Username<input autoComplete="off" name="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}" {...fieldAria(state, "username", resultId)} /></label>
      <label>Role<select name="role" defaultValue="support_agent" {...fieldAria(state, "role", resultId)}>{ADMIN_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></label>
      <label>Temporary password<input autoComplete="new-password" name="password" required minLength={minPasswordLength} maxLength={256} type="password" {...fieldAria(state, "password", resultId)} /></label>
      <BusyButton pending={pending} className="primary-button" pendingLabel="Adding…">Add operator</BusyButton>
      <FormResult id={resultId} state={state} pending={pending} formRef={formRef} />
    </form>
  );
}
