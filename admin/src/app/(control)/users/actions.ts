"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, type AdminOperator } from "@/lib/admin-auth";
import { logAdminEvent } from "@/lib/audit";
import { BULK_SUSPEND_MAX, confirmsDeletion, normalisePeopleQuery, parsePeopleFilters, peopleHref, selectedIds } from "@/components/users/people-filters";
import { accountRefusal, bulkRefusal } from "@/components/users/people-notices";
import type { FormState } from "@/lib/content/form";
import { isUuid } from "@/lib/data/people";
import { logServerError } from "@/lib/log";
import { noticeHref } from "@/lib/notice";
import { sealPeopleSearch } from "@/lib/people-search";
import { removeSocialMediaFiles } from "@/lib/social-media-storage";
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
/** What an action on a member account works with: the service client, and any old Admin team membership. */
type Target = { admin: AdminClient; membership: Membership };

// The member page's forms with a typed reason (and Delete's typed confirmation) and the Users list's selection form are
// client forms on useActionState (components/users/account-forms.tsx, bulk-users-form.tsx). An action refused before
// anything changed returns its refusal, which the form shows beside its button while it keeps what was typed (BUGS.md
// 63); an action that changed something goes back to its page with the result sealed (BUGS.md 1).

/** Back to the member's page with the result sealed for the operator who acted (lib/notice.ts). */
function back(actorId: string, id: string, notice: string): never {
  redirect(noticeHref(`/users/${id}`, notice, actorId));
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
 * The service client for an action on a member account, or why there is none: "configuration" (no server key) or
 * "failed" (logged). Operators are not member accounts, so there is no "yourself" or Admin team rule any more; an old
 * Google-era Admin membership (fitx_admin_members) is still read so a deletion can say whether the account had one.
 */
async function checkTarget(id: string): Promise<Target | "configuration" | "failed"> {
  const admin = createAdminSupabase();
  if (!admin) return "configuration";
  const { data, error } = await admin.from("fitx_admin_members").select("is_active").eq("user_id", id).maybeSingle();
  if (error && !isMissingTable(error)) {
    logServerError("people.check_target", error);
    return "failed";
  }
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

/**
 * Writes the "requested" audit row: null when it is recorded, else why not ("audit_migration", "audit_failed"), and
 * then the action must not run.
 */
async function recordIntent(actor: AdminOperator, id: string, action: "user_suspend_requested" | "user_unsuspend_requested" | "user_password_reset_requested" | "user_delete_requested", details: Record<string, unknown>): Promise<"audit_migration" | "audit_failed" | null> {
  const intent = await logAdminEvent({ actor, action, resourceType: "user", resourceId: id, details });
  if (intent.ok) return null;
  return intent.reason === "migration_pending" ? "audit_migration" : "audit_failed";
}

/**
 * The member page's Suspend access, for useActionState. A refusal (a reason that is not 3 to 200 characters, no server
 * key, an audit row that could not be written, Supabase refusing the ban) comes back beside the button with the reason
 * kept; a suspension goes back to the page with its result sealed.
 */
export async function suspendAccount(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("people.suspend");
  const id = readId(formData);
  const reason = readReason(formData);
  if (!reason) return accountRefusal("reason_required");
  const target = await checkTarget(id);
  if (typeof target === "string") return accountRefusal(target);
  const unrecorded = await recordIntent(actor, id, "user_suspend_requested", { reason });
  if (unrecorded) return accountRefusal(unrecorded);
  const { admin } = target;

  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: SUSPEND_DURATION });
  if (error) {
    logServerError("people.suspend", error);
    await logAdminEvent({ actor, action: "user_suspend_failed", resourceType: "user", resourceId: id, details: { reason, error: error.code ?? error.status ?? null } });
    return accountRefusal("failed");
  }
  // End existing sessions too, so the suspension applies now rather than at the next token refresh.
  const revoked = await admin.rpc("fitx_admin_op_revoke_user_sessions", { p_operator_id: actor.id, p_user_id: id, p_reason: `Suspended: ${reason}` });
  const sessionsPending = revoked.error ? isMissingFunction(revoked.error) : false;
  if (revoked.error && !sessionsPending) logServerError("people.suspend_sessions", revoked.error);
  await logAdminEvent({
    actor,
    action: "user_suspended",
    resourceType: "user",
    resourceId: id,
    details: { reason, sessions_revoked: revoked.error ? null : revoked.data },
  });
  revalidatePath(`/users/${id}`);
  back(actor.id, id, !revoked.error ? "suspended" : sessionsPending ? "suspended_sessions_pending" : "suspended_sessions_failed");
}

/** The member page's Lift suspension, for useActionState: refused as Suspend access is; a lifted suspension goes back sealed. */
export async function unsuspendAccount(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("people.suspend");
  const id = readId(formData);
  const reason = readReason(formData);
  if (!reason) return accountRefusal("reason_required");
  const target = await checkTarget(id);
  if (typeof target === "string") return accountRefusal(target);
  const unrecorded = await recordIntent(actor, id, "user_unsuspend_requested", { reason });
  if (unrecorded) return accountRefusal(unrecorded);
  const { admin } = target;

  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
  if (error) {
    logServerError("people.unsuspend", error);
    await logAdminEvent({ actor, action: "user_unsuspend_failed", resourceType: "user", resourceId: id, details: { reason, error: error.code ?? error.status ?? null } });
    return accountRefusal("failed");
  }
  await logAdminEvent({ actor, action: "user_unsuspended", resourceType: "user", resourceId: id, details: { reason } });
  revalidatePath(`/users/${id}`);
  back(actor.id, id, "unsuspended");
}

/**
 * The member page's Sign out everywhere, for useActionState. A refusal (the reason, no server key, the database
 * function missing or refusing) comes back beside the button with the reason kept; done, it goes back sealed.
 */
export async function revokeSessions(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("people.support");
  const id = readId(formData);
  const reason = readReason(formData);
  if (!reason) return accountRefusal("reason_required");
  const target = await checkTarget(id);
  if (typeof target === "string") return accountRefusal(target);

  // The database function signs the account out everywhere and writes the audit row in one transaction.
  const { error } = await target.admin.rpc("fitx_admin_op_revoke_user_sessions", { p_operator_id: actor.id, p_user_id: id, p_reason: reason });
  if (error) {
    if (isMissingFunction(error)) return accountRefusal("people_migration");
    // A permission error is either the role check or Postgres refusing to touch auth.sessions; the log says which.
    logServerError("people.revoke_sessions", error);
    return accountRefusal(isPermissionError(error) ? "revoke_refused" : "failed");
  }
  back(actor.id, id, "sessions_revoked");
}

/** The member page's Send reset email: a form with nothing typed in it, so every result goes back sealed. */
export async function sendPasswordReset(formData: FormData) {
  const actor = await requireAdmin("people.support");
  const id = readId(formData);
  if (process.env.FITX_ADMIN_PASSWORD_RESET_EMAILS !== "on") back(actor.id, id, "reset_disabled");
  const target = await checkTarget(id);
  if (typeof target === "string") back(actor.id, id, target);
  const { admin } = target;

  const { data, error: lookupError } = await admin.auth.admin.getUserById(id);
  const user = data?.user;
  if (lookupError || !user?.email) back(actor.id, id, lookupError ? "failed" : "no_email");
  const providers = (user.identities ?? []).map((identity) => identity.provider);
  if (!providers.includes("email")) back(actor.id, id, "no_password");

  const unrecorded = await recordIntent(actor, id, "user_password_reset_requested", {});
  if (unrecorded) back(actor.id, id, unrecorded);
  const { error } = await admin.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${customerSiteUrl()}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error) {
    logServerError("people.password_reset", error);
    await logAdminEvent({ actor, action: "user_password_reset_failed", resourceType: "user", resourceId: id, details: { error: error.code ?? error.status ?? null } });
    back(actor.id, id, "reset_failed");
  }
  await logAdminEvent({ actor, action: "user_password_reset_sent", resourceType: "user", resourceId: id });
  back(actor.id, id, "reset_sent");
}

/**
 * The member page's Delete the account, for useActionState. A refusal (the reason, a confirmation that does not match
 * the account, a subscription Razorpay still bills, an audit row that could not be written, a failed step) comes back
 * beside the button with the reason and the typed confirmation kept, and the account is still there; a deletion goes
 * to the Users list with its result sealed.
 */
export async function deleteAccount(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("people.delete");
  const id = readId(formData);
  const reason = readReason(formData);
  if (!reason) return accountRefusal("reason_required");
  const target = await checkTarget(id);
  if (typeof target === "string") return accountRefusal(target);
  const { admin, membership } = target;

  const { data, error: lookupError } = await admin.auth.admin.getUserById(id);
  if (lookupError || !data?.user) return accountRefusal("failed");
  // The email; for an account without one, its phone number, or else the start of its account ID.
  if (!confirmsDeletion(formData.get("confirmEmail"), { id, email: data.user.email, phone: data.user.phone })) return accountRefusal("confirm_mismatch");
  // A Google-era Admin membership goes with the account (on delete cascade); it no longer signs anyone in.
  // Razorpay would keep charging a deleted account, so a subscription it still bills is cancelled first.
  const billed = await hasBilledSubscription(admin, id);
  if (billed === null) return accountRefusal("failed");
  if (billed) return accountRefusal("billing_active");

  const unrecorded = await recordIntent(actor, id, "user_delete_requested", { reason, was_admin_member: Boolean(membership) });
  if (unrecorded) return accountRefusal(unrecorded);

  // Profile photos live in Storage under the account ID; database rows go with the account.
  const files = await listMediaFiles(admin, id);
  if (files.error) {
    logServerError("people.delete_storage_list", files.error);
    await logAdminEvent({ actor, action: "user_delete_failed", resourceType: "user", resourceId: id, details: { reason, step: "storage" } });
    return accountRefusal("delete_failed");
  }
  let filesRemoved = 0;
  for (let start = 0; start < files.paths.length; start += STORAGE_PAGE) {
    const batch = files.paths.slice(start, start + STORAGE_PAGE);
    const removed = await admin.storage.from(USER_MEDIA_BUCKET).remove(batch);
    if (removed.error) {
      logServerError("people.delete_storage_remove", removed.error);
      await logAdminEvent({ actor, action: "user_delete_failed", resourceType: "user", resourceId: id, details: { reason, step: "storage", files_removed: filesRemoved } });
      return accountRefusal("delete_failed");
    }
    filesRemoved += removed.data?.length ?? batch.length;
  }
  // Explore photos live in their own private bucket (social-media/<id>/…); they go before the login too.
  const social = await removeSocialMediaFiles(admin, id);
  filesRemoved += social.removed;
  if (social.error) {
    logServerError("people.delete_social_storage", social.error);
    await logAdminEvent({ actor, action: "user_delete_failed", resourceType: "user", resourceId: id, details: { reason, step: "social_storage", files_removed: filesRemoved } });
    return accountRefusal("delete_failed");
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    logServerError("people.delete", error);
    await logAdminEvent({ actor, action: "user_delete_failed", resourceType: "user", resourceId: id, details: { reason, step: "account", error: error.code ?? error.status ?? null } });
    return accountRefusal("delete_failed");
  }
  await logAdminEvent({ actor, action: "user_deleted", resourceType: "user", resourceId: id, details: { reason, files_removed: filesRemoved } });
  revalidatePath("/users");
  redirect(noticeHref("/users", "deleted", actor.id));
}

/** Where a bulk action returns: the Users list with the filters it had. */
function listReturn(formData: FormData): string {
  const value = formData.get("return");
  return typeof value === "string" && /^\/users(\?[^\s]*)?$/.test(value) && !value.startsWith("//") ? value : "/users";
}

/** The list with its filters and the result sealed for the operator who acted; a count comes from this action only. */
function withNotice(actorId: string, path: string, notice: string, count: number | null = null): string {
  return noticeHref(path, notice, actorId, { count });
}

/**
 * Suspends up to 50 selected accounts with one reason, after the confirmation box is ticked: each is banned
 * in Supabase Auth and signed out everywhere, with its own audit rows, then one row records the batch. For
 * useActionState: while no account is suspended yet, a refusal (none or too many selected, the reason, no tick, no
 * server key, the audit log, Supabase refusing them all) comes back beside the buttons with the reason, the tick and
 * the ticked rows kept; once one is, the list reloads with the result sealed, counted by this action.
 */
export async function suspendSelected(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("people.suspend");
  const list = listReturn(formData);
  const ids = selectedIds(formData.getAll("ids"));
  if (!ids.length) return bulkRefusal("none_selected");
  if (ids.length > BULK_SUSPEND_MAX) return bulkRefusal("too_many");
  const reason = readReason(formData);
  if (!reason) return bulkRefusal("reason_required");
  if (formData.get("confirm") !== "yes") return bulkRefusal("confirm_needed");
  const admin = createAdminSupabase();
  if (!admin) return bulkRefusal("configuration");

  let suspended = 0;
  let failed = 0;
  for (const id of ids) {
    const intent = await logAdminEvent({ actor, action: "user_suspend_requested", resourceType: "user", resourceId: id, details: { reason, bulk: true } });
    if (!intent.ok) {
      const code = intent.reason === "migration_pending" ? "audit_migration" : "audit_failed";
      if (!suspended) return bulkRefusal(code);
      revalidatePath("/users");
      redirect(withNotice(actor.id, list, code, suspended));
    }
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: SUSPEND_DURATION });
    if (error) {
      failed += 1;
      logServerError("people.bulk_suspend", error);
      await logAdminEvent({ actor, action: "user_suspend_failed", resourceType: "user", resourceId: id, details: { reason, bulk: true, error: error.code ?? error.status ?? null } });
      continue;
    }
    const revoked = await admin.rpc("fitx_admin_op_revoke_user_sessions", { p_operator_id: actor.id, p_user_id: id, p_reason: `Suspended: ${reason}` });
    if (revoked.error && !isMissingFunction(revoked.error)) logServerError("people.bulk_suspend_sessions", revoked.error);
    await logAdminEvent({ actor, action: "user_suspended", resourceType: "user", resourceId: id, details: { reason, bulk: true, sessions_revoked: revoked.error ? null : revoked.data } });
    suspended += 1;
  }
  await logAdminEvent({ actor, action: "users_bulk_suspended", resourceType: "user", details: { reason, selected: ids.length, suspended, failed } });
  if (!suspended) return bulkRefusal("none_suspended");
  revalidatePath("/users");
  redirect(withNotice(actor.id, list, failed ? "bulk_partial" : "bulk_suspended", suspended));
}

/** Opens Notifications with the selected accounts as recipients; with none ticked, says so beside the buttons. */
export async function noticeSelected(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin("notifications.send");
  const ids = selectedIds(formData.getAll("ids")).slice(0, 500);
  if (!ids.length) return bulkRefusal("none_selected");
  redirect(`/notifications?to=${ids.join(",")}`);
}

/**
 * The Users list's selection form, for useActionState: Suspend selected or Send notice to selected, by the button that
 * was pressed ("do", which keepTyped sends as the browser would). Each checks its own permission.
 */
export async function bulkUsers(previous: FormState, formData: FormData): Promise<FormState> {
  if (formData.get("do") === "notice") return noticeSelected(previous, formData);
  return suspendSelected(previous, formData);
}

/**
 * The Users search form posts here, so the search text (an email, a phone number) stays out of the URL and
 * so out of request logs and browser history. It comes back to the list sealed in an opaque token.
 */
export async function searchUsers(formData: FormData) {
  const actor = await requireAdmin("people.view");
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : undefined;
  };
  const filters = parsePeopleFilters({ status: field("status"), method: field("method"), plan: field("plan") }, normalisePeopleQuery(formData.get("q")));
  const token = filters.q ? sealPeopleSearch(filters.q, actor.id) : null;
  if (filters.q && !token) redirect(noticeHref("/users", "configuration", actor.id));
  redirect(peopleHref(filters, { page: 1 }, token));
}
