import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Notice, Panel, consoleStyles as ui } from "@/components/console/ui";
import { deleteConfirmation, formatPhone, methodLabels, METHOD_LABELS, subscriptionLabel } from "@/components/users/people-filters";
import styles from "@/components/users/users.module.css";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { getPerson, isSuspended } from "@/lib/data/people";
import { can, ROLE_LABELS } from "@/lib/roles";
import { MIGRATIONS } from "@/lib/schema";
import { formatIstDate, formatIstDateTime } from "@/lib/time";
import { deleteAccount, revokeSessions, sendPasswordReset, suspendAccount, unsuspendAccount } from "../actions";

export const metadata: Metadata = { title: "Account" };

const GOALS: Record<string, string> = {
  muscle_gain: "Muscle gain", weight_gain: "Weight gain", fat_loss: "Fat loss", weight_loss: "Weight loss", strength: "Strength",
  general_fitness: "General fitness", endurance: "Endurance", maintain_weight: "Maintain weight",
};


const notices: Record<string, { tone: "success" | "error"; text: string }> = {
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="detail-field"><dt>{label}</dt><dd>{children}</dd></div>;
}

const dash = <span aria-label="Not known">–</span>;

const PLACES: Record<string, string> = { gym: "Gym", home: "Home", both: "Gym and home", outdoor: "Outdoors" };

/**
 * A Workouts setup answer: "Not set" until the member has done the setup (the stored value is then only the column
 * default, as the app's Profile treats it), the answer after, and a dash when the setup state could not be read.
 */
function trainingValue(known: boolean | null, value: string | null) {
  if (known === false) return <span className="field-note">Not set</span>;
  if (known === null || value === null) return dash;
  return value;
}

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireAdmin("people.view");
  const { id } = await params;
  const { notice } = await searchParams;
  const result = await getPerson(id);
  if (result.state === "not_found") notFound();

  const back = <Link href="/users" className="text-link back-link"><ArrowLeft aria-hidden="true" size={15} />All accounts</Link>;
  if (result.state !== "ready") return <div className="page-stack">{back}<ModuleState state={result.state} /></div>;

  const person = result.person;
  const suspended = isSuspended(person.bannedUntil);
  const resetEnabled = process.env.FITX_ADMIN_PASSWORD_RESET_EMAILS === "on";
  const message = notice ? notices[notice] : undefined;
  const title = person.email ?? formatPhone(person.phone) ?? "No email or phone";
  const deleteCheck = deleteConfirmation(person);
  const plan = subscriptionLabel(person.subscriptionStatus, person.premium);

  return (
    <div className="page-stack narrow-stack">
      {back}
      <header className={`${styles.profileHead} ${ui.rise}`}>
        <span className={styles.avatar} aria-hidden="true">{(person.displayName ?? title).slice(0, 1).toUpperCase()}</span>
        <div className="page-heading-row">
          <div>
            <p className="eyebrow">Account</p>
            <h1 className="break-anywhere">{title}</h1>
            <p className="page-lede"><span className={`status-pill ${suspended ? "status-danger" : "status-good"}`}><i />{suspended ? "Suspended" : "Active"}</span>{" "}{person.displayName ?? ""}</p>
          </div>
        </div>
      </header>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className={`${ui.columns} ${ui.stagger}`}>
        <Panel title="Sign-in" flush>
          <dl className="detail-list detail-panel">
            <Field label="Email">{person.email ?? dash}</Field>
            <Field label="Phone">{formatPhone(person.phone) ?? dash}</Field>
            <Field label="Methods">{methodLabels(person.providers).join(", ") || dash}</Field>
            <Field label="Confirmed">{person.emailConfirmedAt ? formatIstDateTime(person.emailConfirmedAt) : person.phoneConfirmedAt ? formatIstDateTime(person.phoneConfirmedAt) : "Not confirmed"}</Field>
            <Field label="Joined">{formatIstDateTime(person.createdAt) ?? dash}</Field>
            <Field label="Last sign-in">{formatIstDateTime(person.lastSignInAt) ?? "Never"}</Field>
            <Field label="Authenticator">{person.hasAuthenticator ? "Set up" : "Not set up"}</Field>
            <Field label="Account ID"><code className="mono-cell">{person.id}</code></Field>
            {person.adminRole && <Field label="Old Google Admin">{`${ROLE_LABELS[person.adminRole]}${person.adminActive ? "" : " (inactive)"}`}</Field>}
          </dl>
        </Panel>

        <div className={ui.stack}>
          <Panel title="Subscription" hint="Razorpay">
            <p className="metric-definition">{plan ? <span className={`status-pill ${plan.tone === "good" ? "status-good" : plan.tone === "warn" ? "status-warn" : "status-neutral"}`}>{plan.text}</span> : "Billing could not be read."}</p>
            {person.subscriptions && person.subscriptions.length > 0 && (
              <dl className="detail-list">
                {person.subscriptions.slice(0, 3).map((row) => <Field key={row.createdAt} label={`${row.mode === "live" ? "Live" : "Test"} · ${formatIstDate(row.createdAt) ?? ""}`}>{subscriptionLabel(row.status, false)?.text}{row.paidUntil ? ` · paid to ${formatIstDate(row.paidUntil)}` : ""}</Field>)}
              </dl>
            )}
          </Panel>
          <Panel title="Profile" hint="No body, meal or workout data">
            {person.profile ? (
              <dl className="detail-list">
                <Field label="Name">{person.profile.name ?? dash}</Field>
                <Field label="Goal">{person.profile.goal ? (GOALS[person.profile.goal] ?? person.profile.goal) : dash}</Field>
                <Field label="Experience">{trainingValue(person.profile.trainingKnown, person.profile.experience ? person.profile.experience[0].toUpperCase() + person.profile.experience.slice(1) : null)}</Field>
                <Field label="Trains at">{trainingValue(person.profile.trainingKnown, person.profile.place ? (PLACES[person.profile.place] ?? person.profile.place) : null)}</Field>
                <Field label="Days a week">{trainingValue(person.profile.trainingKnown, person.profile.daysPerWeek === null ? null : String(person.profile.daysPerWeek))}</Field>
                <Field label="Set-up">{person.profile.setUp === null ? dash : person.profile.setUp ? `Done${person.profile.profileCreatedAt ? ` · since ${formatIstDate(person.profile.profileCreatedAt)}` : ""}` : "Not finished"}</Field>
              </dl>
            ) : <p className="metric-definition">The profile could not be read.</p>}
          </Panel>
          {person.identities.length > 0 && (
            <Panel title="Linked sign-ins">
              {person.identities.map((identity) => (
                <div className={styles.identity} key={`${identity.provider}-${identity.createdAt}`}>
                  <span className={styles.method}>{METHOD_LABELS[identity.provider] ?? identity.provider}</span>
                  <span>{identity.lastSignInAt ? `Last used ${formatIstDateTime(identity.lastSignInAt)}` : "Not used yet"}</span>
                  <small>Linked {formatIstDate(identity.createdAt) ?? ""}</small>
                </div>
              ))}
            </Panel>
          )}
        </div>
      </div>

      <section className={`action-grid ${ui.stagger}`} aria-label="Account actions">
        {can(actor.role, "people.suspend") && (
          <article className={`table-panel action-card${suspended ? "" : " action-danger"}`}>
            <h2>{suspended ? "Lift the suspension" : "Suspend access"}</h2>
            <p>{suspended ? "They can sign in again straight away." : "Bans sign-in in Supabase Auth and ends every session on every device."}</p>
            <form action={suspended ? unsuspendAccount : suspendAccount} className="stack-form">
              <input type="hidden" name="userId" value={person.id} />
              <label>Reason (audit log)<input name="reason" required minLength={3} maxLength={200} /></label>
              <button className={suspended ? "primary-button" : "danger-button"} type="submit">{suspended ? "Lift suspension" : "Suspend account"}</button>
            </form>
          </article>
        )}
        {can(actor.role, "people.support") && (
          <article className="table-panel action-card">
            <h2>Sign out everywhere</h2>
            <p>Ends every session. They can sign in again unless suspended.</p>
            <form action={revokeSessions} className="stack-form">
              <input type="hidden" name="userId" value={person.id} />
              <label>Reason (audit log)<input name="reason" required minLength={3} maxLength={200} placeholder="For example: lost phone" /></label>
              <button className="quiet-button" type="submit">Sign out everywhere</button>
            </form>
          </article>
        )}
        {can(actor.role, "people.support") && person.hasPasswordSignIn && (
          <article className="table-panel action-card">
            <h2>Password reset email</h2>
            <p>{resetEnabled ? "Supabase emails a link to choose a new password." : "Switched off (README, Password reset emails)."}</p>
            <form action={sendPasswordReset}>
              <input type="hidden" name="userId" value={person.id} />
              <button className="quiet-button" type="submit" disabled={!resetEnabled}>Send reset email</button>
            </form>
          </article>
        )}
        {can(actor.role, "people.delete") && (
          <article className="table-panel action-card action-danger">
            <h2>Delete the account</h2>
            <p>Deletes the account, its FITX data and private photos. Payment records stay, unlinked. Cannot be undone.</p>
            <form action={deleteAccount} className="stack-form">
              <input type="hidden" name="userId" value={person.id} />
              <label>Reason (audit log)<input name="reason" required minLength={3} maxLength={200} /></label>
              <label>{deleteCheck.label}<input name="confirmEmail" required autoComplete="off" placeholder={deleteCheck.expected} /></label>
              <button className="danger-button" type="submit">Delete permanently</button>
            </form>
          </article>
        )}
      </section>
      <p className="privacy-note">{result.viewLogged.ok ? "This view is in the audit log." : result.viewLogged.reason === "migration_pending" ? `Views are not recorded until ${MIGRATIONS.adminV2} is applied.` : "This view could not be recorded in the audit log."}</p>
    </div>
  );
}
