import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { Notice, PageHead, Panel, consoleStyles as ui } from "@/components/console/ui";
import { PERMISSION_LABELS } from "@/components/security/permission-labels";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { listOperators } from "@/lib/operators";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { noticeWords, pageNotice } from "@/lib/notice";
import { ADMIN_ROLES, can, PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS, type AdminRole } from "@/lib/roles";
import { formatIstDate } from "@/lib/time";
import { addOperator, changeOperator, resetPassword } from "./actions";

export const metadata: Metadata = { title: "Access control" };

const notices: Record<string, { tone: "success" | "error"; text: string }> = {
  created: { tone: "success", text: "Operator added. They choose their own password at first sign-in." },
  saved: { tone: "success", text: "Operator updated and recorded in the audit log." },
  password_reset: { tone: "success", text: "Temporary password set. Their open sessions have ended." },
  forbidden: { tone: "error", text: "Only a super-admin can change operators." },
  invalid: { tone: "error", text: "Check the details and try again." },
  invalid_username: { tone: "error", text: "Usernames are 3 to 32 characters: a to z, 0 to 9, dot, dash or underscore." },
  reserved_username: { tone: "error", text: "That username is reserved." },
  username_taken: { tone: "error", text: "That username is taken." },
  invalid_role: { tone: "error", text: "Choose a role." },
  weak_password: { tone: "error", text: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.` },
  same_password: { tone: "error", text: "Choose a different password." },
  not_found: { tone: "error", text: "That operator no longer exists." },
  root_protected: { tone: "error", text: "The owner account cannot be changed here." },
  self: { tone: "error", text: "You cannot change your own access here." },
  confirm_needed: { tone: "error", text: "Tick the confirmation box first." },
  unavailable: { tone: "error", text: "Server data access is not ready." },
  failed: { tone: "error", text: "The change did not complete. The server log has the details." },
};

function RoleSelect({ defaultValue, label }: { defaultValue: AdminRole; label?: string }) {
  return <select aria-label={label} name="role" defaultValue={defaultValue}>{ADMIN_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select>;
}

export default async function AccessControlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("access.view");
  const params = await searchParams;
  const result = await listOperators();
  const manage = can(actor.role, "access.manage");
  const notice = noticeWords(notices, pageNotice(params.state, actor.id));

  return <div className="page-stack">
    <PageHead eyebrow="Admin and security" title="Operators" meta={result.ok ? `${result.value.filter((operator) => operator.isActive).length} active · ${ADMIN_ROLES.length} roles` : undefined} />
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {!result.ok ? <ModuleState state={result.error === "unavailable" ? "migration_pending" : "query_failed"} /> : <>
      {manage && <section className="table-panel">
        <div className="table-heading"><div><h2>Add operator</h2><p>They change this temporary password at first sign-in.</p></div><span className="permission-chip">Super-admin only</span></div>
        <form action={addOperator} className="member-form">
          <label>Username<input autoComplete="off" name="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}" /></label>
          <label>Role<RoleSelect defaultValue="support_agent" /></label>
          <label>Temporary password<input autoComplete="new-password" name="password" required minLength={MIN_PASSWORD_LENGTH} maxLength={256} type="password" /></label>
          <button className="primary-button" type="submit">Add operator</button>
        </form>
      </section>}

      <section className="table-panel">
        <div className="table-heading"><div><h2>Operators</h2></div><span className="data-badge">{result.value.length}</span></div>
        <div className="table-scroll"><table><thead><tr><th>Operator</th><th>Role</th><th>Status</th><th>Last sign-in (IST)</th>{manage && <th>Change</th>}</tr></thead><tbody>
          {result.value.map((operator) => <tr key={operator.id}>
            <td><strong>{operator.username}</strong>{operator.isRoot && <small className="table-subline">Owner account</small>}{operator.mustChangePassword && <small className="table-subline">Temporary password</small>}</td>
            <td>{ROLE_LABELS[operator.role]}</td>
            <td><span className={`status-pill ${operator.isActive ? "status-good" : "status-neutral"}`}><i />{operator.isActive ? "Active" : "Off"}</span></td>
            <td>{operator.lastLoginAt ? formatIstDate(operator.lastLoginAt) : "Never"}</td>
            {manage && <td className="member-actions">
              {operator.isRoot || operator.id === actor.id ? <span className="table-subline">—</span> : <>
                <form action={changeOperator} className="inline-member-form">
                  <input type="hidden" name="operatorId" value={operator.id} />
                  <RoleSelect label={`Role for ${operator.username}`} defaultValue={operator.role} />
                  <select aria-label={`Status for ${operator.username}`} name="active" defaultValue={String(operator.isActive)}><option value="true">Active</option><option value="false">Off</option></select>
                  <label className="check-label"><input type="checkbox" name="confirm" value="yes" required />Confirm</label>
                  <button className="quiet-button" type="submit">Update</button>
                </form>
                <form action={resetPassword} className="inline-member-form">
                  <input type="hidden" name="operatorId" value={operator.id} />
                  <input aria-label={`Temporary password for ${operator.username}`} autoComplete="new-password" name="password" required minLength={MIN_PASSWORD_LENGTH} maxLength={256} type="password" />
                  <label className="check-label"><input type="checkbox" name="confirm" value="yes" required />Confirm</label>
                  <button className="quiet-button" type="submit">Reset password</button>
                </form>
              </>}
            </td>}
          </tr>)}
        </tbody></table></div>
      </section>

      <Panel title="Permissions" hint="What each role can do" flush className={ui.onScroll}>
        <div className="table-scroll">
          <table className={ui.matrix}>
            <thead><tr><th scope="col">Permission</th>{ADMIN_ROLES.map((role) => <th scope="col" key={role} title={ROLE_DESCRIPTIONS[role]}>{ROLE_LABELS[role]}</th>)}</tr></thead>
            <tbody>
              {PERMISSIONS.map((permission) => (
                <tr key={permission}>
                  <td><strong>{PERMISSION_LABELS[permission] ?? permission}</strong></td>
                  {ADMIN_ROLES.map((role) => (
                    <td key={role}>{can(role, permission)
                      ? <><Check className={ui.yes} aria-hidden="true" size={17} /><span className="sr-only">Yes</span></>
                      : <><Minus className={ui.no} aria-hidden="true" size={15} /><span className="sr-only">No</span></>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>}
  </div>;
}
