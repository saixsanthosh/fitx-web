import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserRound } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { getPerson, isSuspended } from "@/lib/data/people";
import { can, ROLE_LABELS } from "@/lib/roles";
import { MIGRATIONS } from "@/lib/schema";
import { formatIstDateTime } from "@/lib/time";
import { deleteAccount, revokeSessions, sendPasswordReset, suspendAccount, unsuspendAccount } from "../actions";

export const metadata: Metadata = { title: "Account" };

const PROVIDER_LABELS: Record<string, string> = { email: "Email and password", google: "Google", apple: "Apple" };

const notices: Record<string, { tone: "success" | "error"; text: string }> = {
  suspended: { tone: "success", text: "The account is suspended and signed out on every device." },
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
  confirm_mismatch: { tone: "error", text: "The email you typed does not match this account, so nothing was deleted." },
  audit_migration: { tone: "error", text: `Nothing was changed: account actions are recorded first, and the audit function needs migration ${MIGRATIONS.adminV2}.` },
  audit_failed: { tone: "error", text: "Nothing was changed because the audit log could not record the action." },
  people_migration: { tone: "error", text: `Signing out everywhere needs migration ${MIGRATIONS.people}.` },
  revoke_refused: { tone: "error", text: "Supabase refused to end the sessions. The server log has the details." },
  delete_failed: { tone: "error", text: "The account was not deleted. The audit log and server log have the details." },
  configuration: { tone: "error", text: "Server data access is not configured." },
  failed: { tone: "error", text: "The change did not complete. The server log has the details." },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="detail-field"><dt>{label}</dt><dd>{children}</dd></div>;
}

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireAdmin("people.view");
  const { id } = await params;
  const { notice } = await searchParams;
  const result = await getPerson(id);
  if (result.state === "not_found") notFound();

  const back = <Link href="/users" className="text-link back-link"><ArrowLeft aria-hidden="true" size={15} />All people</Link>;
  if (result.state !== "ready") return <div className="page-stack">{back}<ModuleState state={result.state} /></div>;

  const person = result.person;
  const suspended = isSuspended(person.bannedUntil);
  // Operators are not member accounts, so no member account is "yours" or protected here.
  const canAct = true;
  const resetEnabled = process.env.FITX_ADMIN_PASSWORD_RESET_EMAILS === "on";
  const message = notice ? notices[notice] : undefined;

  return (
    <div className="page-stack">
      {back}
      <div className="page-heading-row"><div><p className="eyebrow">ACCOUNT</p><h1 className="break-anywhere">{person.email ?? "No email"}</h1><p className="page-lede">Account and sign-in details from Supabase Auth. {result.viewLogged.ok ? "Opening this page is recorded in the audit log." : result.viewLogged.reason === "migration_pending" ? `This view was not recorded: the audit log needs migration ${MIGRATIONS.adminV2}.` : "This view could not be recorded in the audit log; the server log has the details."}</p></div><span className="page-heading-icon"><UserRound aria-hidden="true" size={20} /></span></div>
      {message && <p className={`inline-notice ${message.tone === "success" ? "notice-success" : "notice-error"}`} role="status">{message.text}</p>}

      <section className="table-panel detail-panel" aria-label="Account details">
        <dl className="detail-list">
          <Field label="Status"><span className={`status-pill ${suspended ? "status-danger" : "status-good"}`}><i />{suspended ? "Suspended" : "Can sign in"}</span></Field>
          <Field label="Name from sign-in">{person.displayName ?? "—"}</Field>
          <Field label="Account ID"><code className="mono-cell">{person.id}</code></Field>
          <Field label="Created">{formatIstDateTime(person.createdAt) ?? "—"}</Field>
          <Field label="Last fresh sign-in">{formatIstDateTime(person.lastSignInAt) ?? "Never"}</Field>
          <Field label="Email confirmed">{person.emailConfirmedAt ? formatIstDateTime(person.emailConfirmedAt) : "Not confirmed"}</Field>
          <Field label="Signs in with">{person.providers.map((provider) => PROVIDER_LABELS[provider] ?? provider).join(", ") || "—"}</Field>
          <Field label="Authenticator app">{person.hasAuthenticator ? "Set up" : "Not set up"}</Field>
          {person.adminRole && <Field label="Old Google Admin access">{`${ROLE_LABELS[person.adminRole]}${person.adminActive ? "" : " (inactive)"}`}</Field>}
        </dl>
      </section>


      {canAct && (
        <section className="action-grid" aria-label="Account actions">
          {can(actor.role, "people.support") && (
            <article className="table-panel action-card">
              <h2>Sign out everywhere</h2>
              <p>Ends the person&apos;s sessions on every device. They can sign in again unless suspended.</p>
              <form action={revokeSessions} className="stack-form">
                <input type="hidden" name="userId" value={person.id} />
                <label>Reason (kept in the audit log)<input name="reason" required minLength={3} maxLength={200} placeholder="For example: lost phone" /></label>
                <button className="quiet-button" type="submit">Sign out everywhere</button>
              </form>
            </article>
          )}
          {can(actor.role, "people.support") && (
            <article className="table-panel action-card">
              <h2>Password reset email</h2>
              <p>{!person.hasPasswordSignIn ? "This account signs in with Google only, so there is no password to reset." : resetEnabled ? "Supabase emails a link to choose a new password." : "Switched off until FITX accepts token links; see the README section Password reset emails."}</p>
              <form action={sendPasswordReset}>
                <input type="hidden" name="userId" value={person.id} />
                <button className="quiet-button" type="submit" disabled={!person.hasPasswordSignIn || !resetEnabled}>Send reset email</button>
              </form>
            </article>
          )}
          {can(actor.role, "people.suspend") && (
            <article className="table-panel action-card">
              <h2>{suspended ? "Lift the suspension" : "Suspend"}</h2>
              <p>{suspended ? "The person can sign in again straight away." : "Blocks sign-in and signs the person out everywhere until someone lifts it."}</p>
              <form action={suspended ? unsuspendAccount : suspendAccount} className="stack-form">
                <input type="hidden" name="userId" value={person.id} />
                <label>Reason (kept in the audit log)<input name="reason" required minLength={3} maxLength={200} /></label>
                <button className={suspended ? "quiet-button" : "danger-button"} type="submit">{suspended ? "Lift suspension" : "Suspend account"}</button>
              </form>
            </article>
          )}
          {can(actor.role, "people.delete") && (
            <article className="table-panel action-card action-danger">
              <h2>Delete the account</h2>
              <p>Permanently deletes the account, its FITX data and its private photos. Payment records stay without the link to the person, and the audit log keeps the account ID. This cannot be undone.</p>
              <form action={deleteAccount} className="stack-form">
                <input type="hidden" name="userId" value={person.id} />
                <label>Reason (kept in the audit log)<input name="reason" required minLength={3} maxLength={200} /></label>
                <label>Type the account email to confirm<input name="confirmEmail" required autoComplete="off" placeholder={person.email ?? ""} /></label>
                <button className="danger-button" type="submit">Delete permanently</button>
              </form>
            </article>
          )}
        </section>
      )}
    </div>
  );
}
