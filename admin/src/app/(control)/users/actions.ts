"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, type AdminContext } from "@/lib/admin-auth";
import { logAdminEvent } from "@/lib/audit";
import { isUuid } from "@/lib/data/people";
import { logServerError } from "@/lib/log";
import { can } from "@/lib/roles";
import { isMissingFunction, isMissingTable, isPermissionError } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

/** Supabase bans for a duration; about 100 years means "until someone unsuspends". */
const SUSPEND_DURATION = "876000h";
const USER_MEDIA_BUCKET = "fitx-user-media";
const STORAGE_PAGE = 1000;
/** Razorpay is still billing a subscription in these statuses (the FITX app's src/lib/billing/types.ts). */
const BILLED_SUBSCRIPTION_STATUSES = ["authenticated", "active", "pending", "halted", "paused"];

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;
/** The target's Admin team membership, if it ever had one. */
type Membership = { isActive: boolean } | null;

function back(id: string, notice: string): never {
  redirect(`/users/${id}?notice=${notice}`);
}

function readId(formData: FormData): string {
  const id = formData.get("userId");
  if (!isUuid(id)) redirect("/users");
  return id.toLowerCase();
}

function readReason(formData: FormData): string | null {
  const value = formData.get("reason");
  const reason = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return reason.length >= 3 && reason.length <= 200 ? reason : null;
}

function customerSiteUrl(): string {
  try {
    return new URL(process.env.FITX_SITE_URL || "https://fitnessx.vercel.app").origin;
  } catch {
    return "https://fitnessx.vercel.app";
  }
}

/**
 * Refuses actions on yourself, and on Admin team accounts (inactive ones too, since their access can be
 * switched back on) unless you may manage Admin access.
 */
async function checkTarget(actor: AdminContext, id: string): Promise<{ admin: AdminClient; membership: Membership }> {
  if (id === actor.user.id) back(id, "self");
  const admin = createAdminSupabase();
  if (!admin) back(id, "configuration");
  const { data, error } = await admin.from("fitx_admin_members").select("is_active").eq("user_id", id).maybeSingle();
  if (error) {
    logServerError("people.check_target", error);
    back(id, "failed");
  }
  if (data && !can(actor.role, "access.manage")) back(id, "admin_account");
  return { admin, membership: data ? { isActive: Boolean(data.is_active) } : null };
}

/** Whether Razorpay is still billing a live-mode subscription of this account; null when that cannot be read. */
async function hasBilledSubscription(admin: AdminClient, id: string): Promise<boolean | null> {
  const { data, error } = await admin
    .from("billing_subscriptions")
    .select("id")
    .eq("user_id", id)
    .eq("mode", "live")
    .in("status", BILLED_SUBSCRIPTION_STATUSES)
    .limit(1);
  if (!error) return (data ?? []).length > 0;
  // Without the billing tables nobody has a subscription.
  if (isMissingTable(error)) return false;
  logServerError("people.delete_billing", error);
  return null;
}

/** Every file in the account's private media folder, subfolders included (as the FITX app's own deletion). */
async function listMediaFiles(admin: AdminClient, id: string): Promise<{ paths: string[]; error: unknown }> {
  const paths: string[] = [];
  const folders = [id];
  while (folders.length) {
    const folder = folders.shift() as string;
    for (let offset = 0; ; offset += STORAGE_PAGE) {
      const { data, error } = await admin.storage.from(USER_MEDIA_BUCKET).list(folder, { limit: STORAGE_PAGE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) return /bucket not found/i.test(error.message) ? { paths: [], error: null } : { paths, error };
      const entries = data ?? [];
      for (const entry of entries) {
        // Folders come back without an id (the type says string, the API sends null).
        if ((entry as { id?: string | null }).id) paths.push(`${folder}/${entry.name}`);
        else folders.push(`${folder}/${entry.name}`);
      }
      if (entries.length < STORAGE_PAGE) break;
    }
  }
  return { paths, error: null };
}

/** Writes the "requested" audit row; the action does not run if it cannot be recorded. */
async function recordIntent(actor: AdminContext, id: string, action: "user_suspend_requested" | "user_unsuspend_requested" | "user_password_reset_requested" | "user_delete_requested", details: Record<string, unknown>) {
  const intent = await logAdminEvent({ actorId: actor.user.id, action, resourceType: "user", resourceId: id, details });
  if (!intent.ok) back(id, intent.reason === "migration_pending" ? "audit_migration" : "audit_failed");
}

export async function suspendAccount(formData: FormData) {
  const actor = await requireAdmin("people.suspend");
  const id = readId(formData);
  const reason = readReason(formData);
  if (!reason) back(id, "reason_required");
  const { admin } = await checkTarget(actor, id);
  await recordIntent(actor, id, "user_suspend_requested", { reason });

  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: SUSPEND_DURATION });
  if (error) {
    logServerError("people.suspend", error);
    await logAdminEvent({ actorId: actor.user.id, action: "user_suspend_failed", resourceType: "user", resourceId: id, details: { reason, error: error.code ?? error.status ?? null } });
    back(id, "failed");
  }
  // End existing sessions too, so the suspension applies now rather than at the next token refresh.
  const revoked = await admin.rpc("fitx_admin_revoke_user_sessions", { p_actor_id: actor.user.id, p_user_id: id, p_reason: `Suspended: ${reason}` });
  const sessionsPending = revoked.error ? isMissingFunction(revoked.error) : false;
  if (revoked.error && !sessionsPending) logServerError("people.suspend_sessions", revoked.error);
  await logAdminEvent({
    actorId: actor.user.id,
    action: "user_suspended",
    resourceType: "user",
    resourceId: id,
    details: { reason, sessions_revoked: revoked.error ? null : revoked.data },
  });
  revalidatePath(`/users/${id}`);
  back(id, !revoked.error ? "suspended" : sessionsPending ? "suspended_sessions_pending" : "suspended_sessions_failed");
}

export async function unsuspendAccount(formData: FormData) {
  const actor = await requireAdmin("people.suspend");
  const id = readId(formData);
  const reason = readReason(formData);
  if (!reason) back(id, "reason_required");
  const { admin } = await checkTarget(actor, id);
  await recordIntent(actor, id, "user_unsuspend_requested", { reason });

  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
  if (error) {
    logServerError("people.unsuspend", error);
    await logAdminEvent({ actorId: actor.user.id, action: "user_unsuspend_failed", resourceType: "user", resourceId: id, details: { reason, error: error.code ?? error.status ?? null } });
    back(id, "failed");
  }
  await logAdminEvent({ actorId: actor.user.id, action: "user_unsuspended", resourceType: "user", resourceId: id, details: { reason } });
  revalidatePath(`/users/${id}`);
  back(id, "unsuspended");
}

export async function revokeSessions(formData: FormData) {
  const actor = await requireAdmin("people.support");
  const id = readId(formData);
  const reason = readReason(formData);
  if (!reason) back(id, "reason_required");
  const { admin } = await checkTarget(actor, id);

  // The database function signs the account out everywhere and writes the audit row in one transaction.
  const { error } = await admin.rpc("fitx_admin_revoke_user_sessions", { p_actor_id: actor.user.id, p_user_id: id, p_reason: reason });
  if (error) {
    if (isMissingFunction(error)) back(id, "people_migration");
    if (isPermissionError(error)) {
      // Either the role check or Postgres refusing to touch auth.sessions; the log says which.
      logServerError("people.revoke_sessions", error);
      back(id, "revoke_refused");
    }
    logServerError("people.revoke_sessions", error);
    back(id, "failed");
  }
  back(id, "sessions_revoked");
}

export async function sendPasswordReset(formData: FormData) {
  const actor = await requireAdmin("people.support");
  const id = readId(formData);
  if (process.env.FITX_ADMIN_PASSWORD_RESET_EMAILS !== "on") back(id, "reset_disabled");
  const { admin } = await checkTarget(actor, id);

  const { data, error: lookupError } = await admin.auth.admin.getUserById(id);
  const user = data?.user;
  if (lookupError || !user?.email) back(id, lookupError ? "failed" : "no_email");
  const providers = (user.identities ?? []).map((identity) => identity.provider);
  if (!providers.includes("email")) back(id, "no_password");

  await recordIntent(actor, id, "user_password_reset_requested", {});
  const { error } = await admin.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${customerSiteUrl()}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error) {
    logServerError("people.password_reset", error);
    await logAdminEvent({ actorId: actor.user.id, action: "user_password_reset_failed", resourceType: "user", resourceId: id, details: { error: error.code ?? error.status ?? null } });
    back(id, "reset_failed");
  }
  await logAdminEvent({ actorId: actor.user.id, action: "user_password_reset_sent", resourceType: "user", resourceId: id });
  back(id, "reset_sent");
}

export async function deleteAccount(formData: FormData) {
  const actor = await requireAdmin("people.delete");
  const id = readId(formData);
  const reason = readReason(formData);
  if (!reason) back(id, "reason_required");
  const { admin, membership } = await checkTarget(actor, id);

  const { data, error: lookupError } = await admin.auth.admin.getUserById(id);
  if (lookupError || !data?.user) back(id, "failed");
  const typed = formData.get("confirmEmail");
  if (typeof typed !== "string" || !data.user.email || typed.trim().toLowerCase() !== data.user.email.toLowerCase()) back(id, "confirm_mismatch");
  // Active Admin access is switched off on the Access screen first, so a deletion never removes a working
  // team member by surprise. An inactive membership goes with the account (on delete cascade).
  if (membership?.isActive) back(id, "remove_access_first");
  // Razorpay would keep charging a deleted account, so a subscription it still bills is cancelled first.
  const billed = await hasBilledSubscription(admin, id);
  if (billed === null) back(id, "failed");
  if (billed) back(id, "billing_active");

  await recordIntent(actor, id, "user_delete_requested", { reason, was_admin_member: Boolean(membership) });

  // Profile photos live in Storage under the account ID; database rows go with the account.
  const files = await listMediaFiles(admin, id);
  if (files.error) {
    logServerError("people.delete_storage_list", files.error);
    await logAdminEvent({ actorId: actor.user.id, action: "user_delete_failed", resourceType: "user", resourceId: id, details: { reason, step: "storage" } });
    back(id, "delete_failed");
  }
  let filesRemoved = 0;
  for (let start = 0; start < files.paths.length; start += STORAGE_PAGE) {
    const batch = files.paths.slice(start, start + STORAGE_PAGE);
    const removed = await admin.storage.from(USER_MEDIA_BUCKET).remove(batch);
    if (removed.error) {
      logServerError("people.delete_storage_remove", removed.error);
      await logAdminEvent({ actorId: actor.user.id, action: "user_delete_failed", resourceType: "user", resourceId: id, details: { reason, step: "storage", files_removed: filesRemoved } });
      back(id, "delete_failed");
    }
    filesRemoved += removed.data?.length ?? batch.length;
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    logServerError("people.delete", error);
    await logAdminEvent({ actorId: actor.user.id, action: "user_delete_failed", resourceType: "user", resourceId: id, details: { reason, step: "account", error: error.code ?? error.status ?? null } });
    back(id, "delete_failed");
  }
  await logAdminEvent({ actorId: actor.user.id, action: "user_deleted", resourceType: "user", resourceId: id, details: { reason, files_removed: filesRemoved } });
  revalidatePath("/users");
  redirect("/users?notice=deleted");
}
