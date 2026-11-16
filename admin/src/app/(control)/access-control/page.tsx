import type { Metadata } from "next";
import { Shield } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { listMembers } from "@/lib/data/members";
import { ADMIN_ROLES, can, LEGACY_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type AdminRole } from "@/lib/roles";
import { MIGRATIONS } from "@/lib/schema";
import { formatIstDate } from "@/lib/time";
import { grantAccessByEmail, grantAccessById, resetAuthenticator, updateMember } from "./actions";

export const metadata: Metadata = { title: "Access control" };

const notices: Record<string, { tone: "success" | "error"; text: string }> = {
  saved: { tone: "success", text: "Admin access updated and recorded in the audit log." },
  mfa_reset: { tone: "success", text: "Authenticator removed. The member sets up a new one at their next visit." },
  forbidden: { tone: "error", text: "Only an active super-admin can make that change." },
  invalid: { tone: "error", text: "Check the email, role and status." },
  no_account: { tone: "error", text: "No FITX account uses that email. The person must sign in to FITX with Google once first." },
  ambiguous: { tone: "error", text: "More than one account uses that email. Grant access by account ID instead." },
  user_not_found: { tone: "error", text: "No FITX account was found for that ID." },
  last_super_admin: { tone: "error", text: "That would leave no active super-admin, so nothing changed." },
  confirm_needed: { tone: "error", text: "Tick the confirmation box to reduce someone's access or reset their authenticator." },
  roles_migration: { tone: "error", text: `Granting by email needs migration ${MIGRATIONS.roles}.` },
  role_needs_migration: { tone: "error", text: `That role needs migration ${MIGRATIONS.roles}.` },
  configuration: { tone: "error", text: "Server data access is not configured." },
  save_failed: { tone: "error", text: "The change did not complete. The server log has the details." },
};

function RoleSelect({ roles, defaultValue, label }: { roles: readonly AdminRole[]; defaultValue: AdminRole; label?: string }) {
  return <select aria-label={label} name="role" defaultValue={defaultValue}>{roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select>;
}

export default async function AccessControlPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const actor = await requireAdmin("access.view");
  const params = await searchParams;
  const result = await listMembers();
  const manage = can(actor.role, "access.manage");
  const notice = params.state ? notices[params.state] : undefined;

  return <div className="page-stack">
    <div className="page-heading-row"><div><p className="eyebrow">IDENTITY & PERMISSIONS</p><h1>Access control</h1><p className="page-lede">Who can use FITX Admin and what each role allows. Roles live in the database, never in profile data.</p></div><span className="page-heading-icon"><Shield aria-hidden="true" size={20} /></span></div>
    {notice && <p className={`inline-notice ${notice.tone === "success" ? "notice-success" : "notice-error"}`} role="status">{notice.text}</p>}
    {result.state !== "ready" ? <ModuleState state={result.state} /> : <>
      {manage && <section className="table-panel">
        <div className="table-heading"><div><h2>Grant or change access</h2><p>{result.rolesMigrationApplied ? "Use the email of an existing FITX account. Each change is checked and audited in the database." : `Granting by email and the three new roles need migration ${MIGRATIONS.roles}. Until then, use the Supabase account ID.`}</p></div><span className="permission-chip">Super-admin action</span></div>
        {result.rolesMigrationApplied ? (
          <form action={grantAccessByEmail} className="member-form">
            <label>Account email<input autoComplete="off" name="email" required type="email" placeholder="name@example.com" /></label>
            <label>Role<RoleSelect roles={ADMIN_ROLES} defaultValue="support_agent" /></label>
            <label>Status<select name="active" defaultValue="true"><option value="true">Active</option><option value="false">Inactive</option></select></label>
            <button className="primary-button" type="submit">Save access</button>
          </form>
        ) : (
          <form action={grantAccessById} className="member-form">
            <label>Account ID<input autoComplete="off" name="userId" required pattern="[0-9a-fA-F-]{36}" placeholder="Supabase Auth UUID" /></label>
            <label>Role<RoleSelect roles={LEGACY_ROLES} defaultValue="admin" /></label>
            <label>Status<select name="active" defaultValue="true"><option value="true">Active</option><option value="false">Inactive</option></select></label>
            <button className="primary-button" type="submit">Save access</button>
          </form>
        )}
        <p className="table-note">A new member also needs their email on <code>FITX_ADMIN_ALLOWED_EMAILS</code> in the Admin Vercel project, and sets up an authenticator app at first sign-in.</p>
      </section>}

      <section className="table-panel">
        <div className="table-heading"><div><h2>Admin team</h2><p>Allowlist and authenticator status are checked live.</p></div><span className="data-badge">{result.members.length} members</span></div>
        {result.members.length ? <div className="table-scroll"><table><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Can sign in</th><th>Authenticator</th><th>Last sign-in (IST)</th>{manage && <th>Change</th>}</tr></thead><tbody>
          {result.members.map((member) => <tr key={member.userId}>
            <td><strong>{member.email ?? "Email unavailable"}</strong><small className="table-subline mono-cell">{member.userId}</small></td>
            <td>{ROLE_LABELS[member.role]}</td>
            <td><span className={`status-pill ${member.isActive ? "status-good" : "status-neutral"}`}><i />{member.isActive ? "Active" : "Inactive"}</span></td>
            <td>{member.onAllowlist ? "Yes" : <span className="warning-text">Not on FITX_ADMIN_ALLOWED_EMAILS</span>}</td>
            <td>{member.hasAuthenticator === null ? "—" : member.hasAuthenticator ? "Set up" : "Not yet"}</td>
            <td>{member.lastSignInAt ? formatIstDate(member.lastSignInAt) : "—"}</td>
            {manage && <td className="member-actions">
              <form action={updateMember} className="inline-member-form">
                <input type="hidden" name="userId" value={member.userId} />
                <input type="hidden" name="currentRole" value={member.role} />
                <input type="hidden" name="currentActive" value={String(member.isActive)} />
                <RoleSelect label={`Role for ${member.email ?? member.userId}`} roles={result.rolesMigrationApplied ? ADMIN_ROLES : LEGACY_ROLES} defaultValue={member.role} />
                <select aria-label={`Status for ${member.email ?? member.userId}`} name="active" defaultValue={String(member.isActive)}><option value="true">Active</option><option value="false">Inactive</option></select>
                <label className="check-label"><input type="checkbox" name="confirm" value="yes" />Confirm</label>
                <button className="quiet-button" type="submit">Update</button>
              </form>
              {member.hasAuthenticator && <form action={resetAuthenticator} className="inline-member-form">
                <input type="hidden" name="userId" value={member.userId} />
                <label className="check-label"><input type="checkbox" name="confirm" value="yes" required />Confirm</label>
                <button className="quiet-button" type="submit">Reset authenticator</button>
              </form>}
            </td>}
          </tr>)}
        </tbody></table></div> : <div className="empty-state"><h3>No administrator has been provisioned</h3><p>The first super-admin is assigned with the owner-only SQL in the Admin README.</p></div>}
      </section>

      <section className="table-panel">
        <div className="table-heading"><div><h2>Roles</h2><p>Every page, data read and change checks these on the server; the database functions check them again.</p></div></div>
        <div className="settings-list">{ADMIN_ROLES.map((role) => <div className="settings-row" key={role}><span><strong>{ROLE_LABELS[role]}</strong><small>{ROLE_DESCRIPTIONS[role]}</small></span>{!result.rolesMigrationApplied && !LEGACY_ROLES.includes(role) && <span className="status-pill status-neutral"><i />Needs migration</span>}</div>)}</div>
      </section>
      <p className="privacy-note">No public registration, no self-service roles, no client-side role trust. The database refuses grants from anyone but an active super-admin and always keeps one active super-admin.</p>
    </>}
  </div>;
}
