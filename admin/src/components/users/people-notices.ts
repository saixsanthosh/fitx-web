// What the Users screens say after an action, in Admin's own fixed words: a result sealed into ?notice= by the Server
// Action that redirects (lib/notice.ts), or a refusal a form shows beside its button while it keeps what was typed
// (BUGS.md 63). Never text from the address. Imports only people-filters and the schema's migration names (neither
// imports anything), so tests can load it.
import type { FormState } from "@/lib/content/form";
import { MIGRATIONS } from "@/lib/schema";
import { BULK_SUSPEND_MAX } from "./people-filters";

export type PeopleNotice = { tone: "success" | "error"; text: string };

/** The member page: the results its actions seal, and the refusals its forms show beside their buttons. */
export const ACCOUNT_NOTICES: Record<string, PeopleNotice> = {
  suspended: { tone: "success", text: "Suspended and signed out on every device. A page already open works until its access token runs out, within an hour." },
  suspended_sessions_pending: { tone: "success", text: `The account is suspended. Its open sessions stop at their next refresh, within an hour, because signing out everywhere needs migration ${MIGRATIONS.people}.` },
  suspended_sessions_failed: { tone: "error", text: "The account is suspended, but Supabase refused to end its open sessions (the server log has the details). They stop at their next refresh, within an hour." },
  unsuspended: { tone: "success", text: "The suspension is lifted. The person can sign in again." },
  sessions_revoked: { tone: "success", text: "Signed out on every device. Access already granted runs out within an hour." },
  reset_sent: { tone: "success", text: "Supabase sent a password reset email to this address." },
  reset_disabled: { tone: "error", text: "Password reset emails are switched off until FITX accepts token links (see the README, Password reset emails)." },
  no_password: { tone: "error", text: "This account signs in with Google only, so it has no password to reset." },
  no_email: { tone: "error", text: "This account has no email address." },
  reset_failed: { tone: "error", text: "Supabase did not send the email. Its email rate limit may have been reached; try again later." },
  reason_required: { tone: "error", text: "Give a reason of 3 to 200 characters. It is kept in the audit log." },
  billing_active: { tone: "error", text: "Nothing was deleted: Razorpay is still billing this account's FITX subscription. Ask the person to cancel it on the Subscription page in FITX, or cancel it in the Razorpay dashboard, then try again." },
  confirm_mismatch: { tone: "error", text: "What you typed does not match this account, so nothing was deleted." },
  audit_migration: { tone: "error", text: `Nothing was changed: account actions are recorded first, and the audit function needs migration ${MIGRATIONS.adminV2}.` },
  audit_failed: { tone: "error", text: "Nothing was changed because the audit log could not record the action." },
  people_migration: { tone: "error", text: `Signing out everywhere needs migration ${MIGRATIONS.people}.` },
  revoke_refused: { tone: "error", text: "Supabase refused to end the sessions. The server log has the details." },
  delete_failed: { tone: "error", text: "The account was not deleted. The audit log and server log have the details." },
  configuration: { tone: "error", text: "Server data access is not configured." },
  failed: { tone: "error", text: "The change did not complete. The server log has the details." },
};

/** The input (by its name) a member page refusal is about: marked, described by the message and focused. */
const ACCOUNT_FIELDS: Record<string, string> = { reason_required: "reason", confirm_mismatch: "confirmEmail" };

/** "1 account", "3 accounts". */
export const accounts = (count: number) => `${count.toLocaleString("en-IN")} ${count === 1 ? "account" : "accounts"}`;

/**
 * The Users list's words for a result. The count comes sealed with it from the action itself (lib/notice.ts), never
 * from the address; a result without its count (it cannot happen from this page's actions) leaves the number out.
 */
export const LIST_NOTICES: Record<string, { tone: "success" | "error"; text: (count: number | null) => string }> = {
  deleted: { tone: "success", text: () => "Account deleted and recorded in the audit log." },
  bulk_suspended: { tone: "success", text: (count) => (count === null ? "Accounts suspended and signed out everywhere." : `${accounts(count)} suspended and signed out everywhere.`) },
  bulk_partial: { tone: "error", text: (count) => `${count === null ? "Some accounts" : accounts(count)} suspended; Supabase refused the rest. The audit log lists each one.` },
  audit_migration: { tone: "error", text: (count) => `Stopped${count === null ? "" : ` after ${accounts(count)}`}: the audit log needs migration ${MIGRATIONS.adminV2}.` },
  audit_failed: { tone: "error", text: (count) => `Stopped${count === null ? "" : ` after ${accounts(count)}`}: the audit log could not record the next one.` },
  configuration: { tone: "error", text: () => "Server data access is not configured." },
};

/** The Users list's refusals, beside its bulk buttons: no account was suspended, and the reason, tick and rows stay. */
const BULK_REFUSALS: Record<string, string> = {
  none_selected: "Select at least one account.",
  too_many: `Select at most ${BULK_SUSPEND_MAX} accounts at a time.`,
  reason_required: "Give a reason of 3 to 200 characters.",
  confirm_needed: "Tick the confirmation box first.",
  configuration: "Server data access is not configured.",
  audit_migration: `No account was suspended: account actions are recorded first, and the audit function needs migration ${MIGRATIONS.adminV2}.`,
  audit_failed: "No account was suspended because the audit log could not record the action.",
  none_suspended: "No account was suspended: Supabase refused them all. The audit log lists each one.",
};

const BULK_FIELDS: Record<string, string> = { reason_required: "reason", confirm_needed: "confirm" };

function refusal(message: string, field: string | undefined): FormState {
  return { status: "error", message, fieldErrors: field ? { [field]: message } : undefined };
}

/** A member page form's refusal, in the page's words, naming the field it is about; an unknown code reads as a failure. */
export function accountRefusal(code: string): FormState {
  const words = Object.hasOwn(ACCOUNT_NOTICES, code) ? ACCOUNT_NOTICES[code] : ACCOUNT_NOTICES.failed;
  return refusal(words.text, Object.hasOwn(ACCOUNT_FIELDS, code) ? ACCOUNT_FIELDS[code] : undefined);
}

/** A refusal of the Users list's selection form, naming the field it is about; an unknown code reads as a failure. */
export function bulkRefusal(code: string): FormState {
  const message = Object.hasOwn(BULK_REFUSALS, code) ? BULK_REFUSALS[code] : ACCOUNT_NOTICES.failed.text;
  return refusal(message, Object.hasOwn(BULK_FIELDS, code) ? BULK_FIELDS[code] : undefined);
}
