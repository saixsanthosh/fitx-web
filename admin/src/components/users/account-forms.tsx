"use client";

import { useActionState, useId, useRef, type ReactNode } from "react";
import { deleteAccount, revokeSessions, suspendAccount, unsuspendAccount } from "@/app/(control)/users/actions";
import { keepTyped } from "@/components/content/keep-typed";
import { BusyButton, FormResult } from "@/components/form-kit";
import { fieldAria } from "@/components/form-rules";
import { IDLE, type FormState } from "@/lib/content/form";

// The member page's forms with something typed in them: a reason for the audit log, and Delete's typed confirmation.
// A refusal (a reason that is too short, a confirmation that does not match, a subscription Razorpay still bills, the
// audit log, Supabase) comes back beside the button and what was typed stays (keepTyped: React would otherwise reset
// the form after its action, BUGS.md 63); the field it is about is marked and focused, else the message is. An action
// that happened reloads the page with its result at the top.

type AccountAction = (previous: FormState, formData: FormData) => Promise<FormState>;

/** One account action: its fields (drawn with the last answer, to mark the field it is about), its button, its answer. */
function AccountForm({ userId, act, label, pendingLabel, className, fields }: {
  userId: string;
  act: AccountAction;
  label: string;
  pendingLabel: string;
  className: string;
  fields: (state: FormState, resultId: string) => ReactNode;
}) {
  const [state, action, pending] = useActionState(act, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const resultId = useId();
  return (
    <form ref={formRef} action={action} onSubmit={keepTyped(action)} className="stack-form">
      <input type="hidden" name="userId" value={userId} />
      {fields(state, resultId)}
      <BusyButton pending={pending} className={className} pendingLabel={pendingLabel}>{label}</BusyButton>
      <FormResult id={resultId} state={state} pending={pending} formRef={formRef} />
    </form>
  );
}

/** The reason every account action keeps in the audit log (3 to 200 characters). */
function Reason({ state, resultId, placeholder }: { state: FormState; resultId: string; placeholder?: string }) {
  return <label>Reason (audit log)<input name="reason" required minLength={3} maxLength={200} placeholder={placeholder} {...fieldAria(state, "reason", resultId)} /></label>;
}

const reason = (state: FormState, resultId: string) => <Reason state={state} resultId={resultId} />;

/** Suspend access, or Lift the suspension. Each has its own key, so each starts with its own (empty) answer. */
export function SuspensionForm({ userId, suspended }: { userId: string; suspended: boolean }) {
  return suspended
    ? <AccountForm key="lift" userId={userId} act={unsuspendAccount} label="Lift suspension" pendingLabel="Lifting…" className="primary-button" fields={reason} />
    : <AccountForm key="suspend" userId={userId} act={suspendAccount} label="Suspend account" pendingLabel="Suspending…" className="danger-button" fields={reason} />;
}

/** Sign out everywhere, with its reason. */
export function SignOutEverywhereForm({ userId }: { userId: string }) {
  return (
    <AccountForm
      userId={userId}
      act={revokeSessions}
      label="Sign out everywhere"
      pendingLabel="Signing out…"
      className="quiet-button"
      fields={(state, resultId) => <Reason state={state} resultId={resultId} placeholder="For example: lost phone" />}
    />
  );
}

/** Delete the account: the reason, and the account's email (or phone, or the start of its ID) typed to confirm. */
export function DeleteAccountForm({ userId, confirmLabel, expected }: { userId: string; confirmLabel: string; expected: string }) {
  return (
    <AccountForm
      userId={userId}
      act={deleteAccount}
      label="Delete permanently"
      pendingLabel="Deleting…"
      className="danger-button"
      fields={(state, resultId) => (
        <>
          <Reason state={state} resultId={resultId} />
          <label>{confirmLabel}<input name="confirmEmail" required autoComplete="off" placeholder={expected} {...fieldAria(state, "confirmEmail", resultId)} /></label>
        </>
      )}
    />
  );
}
