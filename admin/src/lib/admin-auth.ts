import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { checkAdminEmail, parseAllowlist, type AdminEmailCheck, type AdminEmailUser } from "@/lib/admin-email";
import { logServerError, logServerWarning } from "@/lib/log";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createUserSupabase } from "@/lib/supabase/server";
import { isAdminRole, type AdminRole } from "@/lib/roles";

type Membership = { role: AdminRole; is_active: boolean };
export type MembershipState =
  | { state: "ready"; membership: Membership }
  | { state: "setup_pending" | "not_authorized" | "service_key_missing" };

export type AllowlistState = { state: "ready"; email: string } | { state: "configuration" | "not_authorized" };

function isMissingAdminSchema(code: string | undefined) {
  return code === "42P01" || code === "PGRST205" || code === "PGRST204";
}

const denialReasons: Record<Extract<AdminEmailCheck, { ok: false }>["reason"], string> = {
  unconfirmed_email: "the account has no confirmed email address",
  no_verified_google_identity: "the account email does not belong to a verified Google identity on this account",
  not_allowlisted: "the account email is not on FITX_ADMIN_ALLOWED_EMAILS",
};

/** Checks the signed-in account's confirmed Google email against FITX_ADMIN_ALLOWED_EMAILS. */
export function checkAdminAllowlist(user: AdminEmailUser, scope: string): AllowlistState {
  const allowlist = parseAllowlist(process.env.FITX_ADMIN_ALLOWED_EMAILS);
  if (!allowlist.size) {
    logServerWarning(scope, "FITX_ADMIN_ALLOWED_EMAILS is empty, so every Admin sign-in is refused");
    return { state: "configuration" };
  }

  const result = checkAdminEmail(user, allowlist);
  if (!result.ok) {
    logServerWarning(scope, `access refused because ${denialReasons[result.reason]}`);
    return { state: "not_authorized" };
  }
  return { state: "ready", email: result.email };
}

export async function readMembership(userId: string): Promise<MembershipState> {
  const admin = createAdminSupabase();
  if (!admin) {
    logServerWarning("admin.membership", "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not set");
    return { state: "service_key_missing" };
  }

  const { data, error } = await admin
    .from("fitx_admin_members")
    .select("role,is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logServerError("admin.membership", error);
    return { state: isMissingAdminSchema(error.code) ? "setup_pending" : "not_authorized" };
  }
  if (!data || !data.is_active || !isAdminRole(data.role)) {
    logServerWarning("admin.membership", "access refused because the account has no active Admin membership");
    return { state: "not_authorized" };
  }
  return { state: "ready", membership: { role: data.role, is_active: data.is_active } };
}

/**
 * Server-side gate for every Admin page, data read and mutation. React's cache shares
 * one check per render, so the layout, the page and its data helpers reuse it.
 * Server Actions are not part of a render, so each action runs the full check.
 */
export const requireAdmin = cache(async () => {
  const supabase = await createUserSupabase();
  if (!supabase) redirect("/access?state=configuration");

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/signin");

  const allowlist = checkAdminAllowlist(user, "admin.require");
  if (allowlist.state !== "ready") redirect(`/access?state=${allowlist.state}`);

  const membership = await readMembership(user.id);
  if (membership.state !== "ready") {
    redirect(`/access?state=${membership.state}`);
  }

  return { user, role: membership.membership.role };
});
