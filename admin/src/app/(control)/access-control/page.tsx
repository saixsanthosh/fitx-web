import type { Metadata } from "next";
import { Shield } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { requireAdmin } from "@/lib/admin-auth";
import { listAdminMembers } from "@/lib/admin-data";
import { setAdminMember } from "./actions";

export const metadata: Metadata = { title: "Access control" };

const notices: Record<string, string> = {
  saved: "Admin membership updated and recorded in the audit log.",
  forbidden: "Only an active super-admin can make that change.",
  invalid: "Check the user ID and selected role.",
  user_not_found: "No Auth user was found for that ID.",
  configuration: "Server data access is not configured.",
  save_failed: "The role update did not complete. The last active super-admin cannot be removed.",
};

export default async function AccessControlPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { role } = await requireAdmin();
  const params = await searchParams;
  const result = await listAdminMembers();
  return <div className="page-stack">
    <div className="page-heading-row"><div><p className="eyebrow">IDENTITY & PERMISSIONS</p><h1>Access control</h1><p className="page-lede">Admin roles are independent of user-editable profile metadata.</p></div><span className="page-heading-icon"><Shield aria-hidden="true" size={20} /></span></div>
    {params.state && notices[params.state] && <p className={`inline-notice ${params.state === "saved" ? "notice-success" : "notice-error"}`} role="status">{notices[params.state]}</p>}
    {result.state !== "ready" ? <ModuleState state={result.state} /> : <>
      {role === "super_admin" && <section className="table-panel">
        <div className="table-heading"><div><h2>Grant or update access</h2><p>Use an existing Supabase Auth user ID. Each change is checked and audited on the database server.</p></div><span className="permission-chip">Super-admin action</span></div>
        <form action={setAdminMember} className="member-form">
          <label>User ID<input autoComplete="off" name="userId" required inputMode="text" pattern="[0-9a-fA-F-]{36}" placeholder="Supabase Auth UUID" /></label>
          <label>Role<select name="role" defaultValue="admin"><option value="admin">Admin</option><option value="super_admin">Super-admin</option></select></label>
          <label>Status<select name="active" defaultValue="true"><option value="true">Active</option><option value="false">Inactive</option></select></label>
          <button className="primary-button" type="submit">Save access</button>
        </form>
      </section>}
      <section className="table-panel">
        <div className="table-heading"><div><h2>Current administrators</h2><p>Member identifiers are limited to this role-protected screen.</p></div><span className="data-badge">{result.members.length} shown</span></div>
        {result.members.length ? <div className="table-scroll"><table><thead><tr><th>Supabase user ID</th><th>Role</th><th>Status</th>{role === "super_admin" && <th>Update</th>}</tr></thead><tbody>
          {result.members.map((member) => <tr key={member.user_id}><td className="mono-cell">{member.user_id}</td><td>{member.role === "super_admin" ? "Super-admin" : "Admin"}</td><td><span className={`status-pill ${member.is_active ? "status-good" : "status-neutral"}`}><i />{member.is_active ? "Active" : "Inactive"}</span></td>{role === "super_admin" && <td><form action={setAdminMember} className="inline-member-form"><input type="hidden" name="userId" value={member.user_id} /><select aria-label={`Role for ${member.user_id}`} name="role" defaultValue={member.role}><option value="admin">Admin</option><option value="super_admin">Super-admin</option></select><select aria-label={`Status for ${member.user_id}`} name="active" defaultValue={String(member.is_active)}><option value="true">Active</option><option value="false">Inactive</option></select><button className="quiet-button" type="submit">Update</button></form></td>}</tr>)}
        </tbody></table></div> : <div className="empty-state"><h3>No administrator has been provisioned</h3><p>The first super-admin must be assigned through the owner-controlled Supabase SQL setup described in the Admin README.</p></div>}
      </section>
      <p className="privacy-note">No public registration, role self-service, or client-side role trust. Database functions reject non-super-admin grants and protect the last active super-admin.</p>
    </>}
  </div>;
}
