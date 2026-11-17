"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { normaliseEmail } from "@/lib/admin-email";
import { logAdminEvent } from "@/lib/audit";
import { isUuid } from "@/lib/data/people";
import { logServerError } from "@/lib/log";
import { ADMIN_ROLES, isAdminRole, type AdminRole } from "@/lib/roles";
import { isMissingFunction, isPermissionError } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createUserSupabase } from "@/lib/supabase/server";

function done(state: string): never {
  revalidatePath("/access-control");
  redirect(`/access-control?state=${state}`);
}

/** Lower number = more access. Used to ask for confirmation before reducing someone's access. */
const RANK: Record<AdminRole, number> = Object.fromEntries(ADMIN_ROLES.map((role, index) => [role, index])) as Record<AdminRole, number>;

async function setMember(actorId: string, userId: string, role: AdminRole, active: boolean): Promise<never> {
  const admin = createAdminSupabase();
  if (!admin) done("configuration");
  const { error } = await admin.rpc("fitx_admin_set_member", { p_actor_id: actorId, p_user_id: userId, p_role: role, p_is_active: active });
  if (error) {
    if (isPermissionError(error)) done("forbidden");
    if (error.code === "23514") done("last_super_admin");
    if (error.code === "22023") done("role_needs_migration");
    if (error.code === "P0002") done("user_not_found");
    logServerError("access.set_member", error);
    done("save_failed");
  }
  revalidatePath("/audit");
  done("saved");
}

function readRoleAndStatus(formData: FormData): { role: AdminRole; active: boolean } {
  const role = formData.get("role");
  const active = formData.get("active");
  if (!isAdminRole(role) || (active !== "true" && active !== "false")) done("invalid");
  return { role, active: active === "true" };
}

/**
 * Asks for the confirmation box when a change lowers an existing member's access (a lower role, or
 * switching them off). The membership is read from the database, so a stale page cannot skip it.
 */
async function confirmIfReducing(formData: FormData, userId: string, role: AdminRole, active: boolean) {
  const admin = createAdminSupabase();
  if (!admin) done("configuration");
  const { data, error } = await admin.from("fitx_admin_members").select("role,is_active").eq("user_id", userId).maybeSingle();
  if (error) {
    logServerError("access.read_member", error);
    done("save_failed");
  }
  if (!data) return;
  const reduces = (Boolean(data.is_active) && !active) || (isAdminRole(data.role) && RANK[role] > RANK[data.role]);
  if (reduces && formData.get("confirm") !== "yes") done("confirm_needed");
}

/** Grants or changes access for the FITX account that uses an email address. */
export async function grantAccessByEmail(formData: FormData) {
  const actor = await requireAdmin("access.manage");
  const email = normaliseEmail(formData.get("email"));
  if (!email) done("invalid");
  const { role, active } = readRoleAndStatus(formData);

  const admin = createAdminSupabase();
  if (!admin) done("configuration");
  const { data, error } = await admin.rpc("fitx_admin_find_user_by_email", { p_email: email });
  if (error) {
    if (isMissingFunction(error)) done("roles_migration");
    logServerError("access.find_user", error);
    done("save_failed");
  }
  const matches = (Array.isArray(data) ? data : []) as Array<{ user_id: string }>;
  if (matches.length === 0) done("no_account");
  if (matches.length > 1) done("ambiguous");
  await confirmIfReducing(formData, matches[0].user_id, role, active);
  await setMember(actor.user.id, matches[0].user_id, role, active);
}

/** The original form, by Supabase account ID, for databases without the roles migration. */
export async function grantAccessById(formData: FormData) {
  const actor = await requireAdmin("access.manage");
  const userId = formData.get("userId");
  if (!isUuid(userId)) done("invalid");
  const { role, active } = readRoleAndStatus(formData);
  const admin = createAdminSupabase();
  if (!admin) done("configuration");
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) done("user_not_found");
  await confirmIfReducing(formData, userId, role, active);
  await setMember(actor.user.id, userId, role, active);
}

/** Changes a member's role or status; reducing access needs the confirmation box. */
export async function updateMember(formData: FormData) {
  const actor = await requireAdmin("access.manage");
  const userId = formData.get("userId");
  if (!isUuid(userId)) done("invalid");
  const { role, active } = readRoleAndStatus(formData);
  await confirmIfReducing(formData, userId, role, active);
  await setMember(actor.user.id, userId, role, active);
}

/**
 * Removes a member's authenticator app (for a lost phone) and then ends every session of the account,
 * so a signed-in lost phone cannot set up an authenticator of its own. The request is recorded before
 * anything changes; the member signs in with Google again and sets up a new one.
 */
export async function resetAuthenticator(formData: FormData) {
  const actor = await requireAdmin("access.manage");
  const rawId = formData.get("userId");
  if (!isUuid(rawId)) done("invalid");
  const userId = rawId.toLowerCase();
  if (formData.get("confirm") !== "yes") done("confirm_needed");

  const admin = createAdminSupabase();
  if (!admin) done("configuration");
  const member = await admin.from("fitx_admin_members").select("user_id").eq("user_id", userId).maybeSingle();
  if (member.error) {
    logServerError("access.mfa_member", member.error);
    done("save_failed");
  }
  if (!member.data) done("user_not_found");

  const intent = await logAdminEvent({ actorId: actor.user.id, action: "admin_mfa_reset_requested", resourceType: "admin_member", resourceId: userId });
  if (!intent.ok) done(intent.reason === "migration_pending" ? "audit_migration" : "audit_failed");

  const listed = await admin.auth.admin.mfa.listFactors({ userId });
  if (listed.error) {
    logServerError("access.mfa_list", listed.error);
    done("save_failed");
  }
  let removed = 0;
  for (const factor of listed.data.factors) {
    const deleted = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
    if (deleted.error) {
      logServerError("access.mfa_delete", deleted.error);
      await logAdminEvent({ actorId: actor.user.id, action: "admin_mfa_reset", resourceType: "admin_member", resourceId: userId, details: { factors_removed: removed, completed: false } });
      done("save_failed");
    }
    removed++;
  }

  // Removing a factor only lowers open sessions to the first sign-in step; it does not end them.
  let sessions: { ended: true; count: number | null } | { ended: false; pending: boolean };
  if (userId === actor.user.id) {
    // Your own reset: end every other session (the lost phone's included) and keep this one.
    const own = await createUserSupabase();
    const signedOut = own ? await own.auth.signOut({ scope: "others" }) : { error: new Error("no session client") };
    if (signedOut.error) logServerError("access.mfa_reset_own_sessions", signedOut.error);
    sessions = signedOut.error ? { ended: false, pending: false } : { ended: true, count: null };
  } else {
    // The database function also writes its own "signed out everywhere" audit row.
    const revoked = await admin.rpc("fitx_admin_revoke_user_sessions", { p_actor_id: actor.user.id, p_user_id: userId, p_reason: "Authenticator reset" });
    const pending = revoked.error ? isMissingFunction(revoked.error) : false;
    if (revoked.error && !pending) logServerError("access.mfa_reset_sessions", revoked.error);
    sessions = revoked.error ? { ended: false, pending } : { ended: true, count: typeof revoked.data === "number" ? revoked.data : null };
  }

  await logAdminEvent({
    actorId: actor.user.id,
    action: "admin_mfa_reset",
    resourceType: "admin_member",
    resourceId: userId,
    details: { factors_removed: removed, completed: true, sessions_ended: sessions.ended, sessions_count: sessions.ended ? sessions.count : null },
  });
  done(sessions.ended ? "mfa_reset" : sessions.pending ? "mfa_reset_sessions_pending" : "mfa_reset_sessions_failed");
}
