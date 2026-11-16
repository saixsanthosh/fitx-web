import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { checkAdminEmail, parseAllowlist, type AdminEmailCheck, type AdminEmailUser } from "@/lib/admin-email";
import { logServerError, logServerWarning } from "@/lib/log";
import { can, isAdminRole, permissionsFor, type AdminRole, type Permission } from "@/lib/roles";
import { evaluateAdminSession } from "@/lib/session-policy";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createUserSupabase } from "@/lib/supabase/server";

type Membership = { role: AdminRole; is_active: boolean };
export type MembershipState =
  | { state: "ready"; membership: Membership }
  | { state: "setup_pending" | "not_authorized" | "service_key_missing" };

export type AllowlistState = { state: "ready"; email: string } | { state: "configuration" | "not_authorized" };

export type AdminIdentity = {
  user: User;
  email: string;
  role: AdminRole;
  /** The account has a verified authenticator app (TOTP factor). */
  hasAuthenticator: boolean;
  /** What the session still needs before it may use Admin: nothing, an authenticator set-up, or a code. */
  mfa: "ok" | "enroll" | "verify";
  /** When this session signed in with Google, in Unix seconds. */
  signedInAt: number;
};

export type AdminContext = AdminIdentity & { permissions: readonly Permission[] };

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

/** The reason code checkAdminEmail gives, for audit rows. */
export function allowlistRefusalReason(user: AdminEmailUser): string {
  const allowlist = parseAllowlist(process.env.FITX_ADMIN_ALLOWED_EMAILS);
  if (!allowlist.size) return "allowlist_empty";
  const result = checkAdminEmail(user, allowlist);
  return result.ok ? "allowed" : result.reason;
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
 * Who is signed in, and whether they may be in Admin at all: a Google account on the allowlist,
 * an active membership, and a session younger than the maximum age. It does not require the
 * authenticator app; the MFA pages use it directly. React's cache shares one check per render.
 */
const loadAdminIdentity = cache(async (): Promise<AdminIdentity> => {
  const supabase = await createUserSupabase();
  if (!supabase) redirect("/access?state=configuration");

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/signin");

  const allowlist = checkAdminAllowlist(user, "admin.require");
  if (allowlist.state !== "ready") redirect(`/access?state=${allowlist.state}`);

  const membership = await readMembership(user.id);
  if (membership.state !== "ready") redirect(`/access?state=${membership.state}`);

  // getClaims verifies the access token before its claims are trusted.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) {
    logServerError("admin.claims", claimsError);
    redirect("/signin");
  }
  const claims = claimsData.claims as unknown as Record<string, unknown>;
  const hasAuthenticator = (user.factors ?? []).some((factor) => factor.factor_type === "totp" && factor.status === "verified");
  const decision = evaluateAdminSession({
    aal: claims.aal,
    amr: claims.amr,
    issuedAt: claims.iat,
    hasVerifiedFactor: hasAuthenticator,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (decision.state === "expired") redirect("/auth/expired");

  return {
    user,
    email: allowlist.email,
    role: membership.membership.role,
    hasAuthenticator,
    mfa: decision.state === "ok" ? "ok" : decision.state,
    signedInAt: decision.signedInAt,
  };
});

/** Admin identity plus a verified authenticator code for this session (Supabase AAL2). */
const loadAdminContext = cache(async (): Promise<AdminContext> => {
  const identity = await loadAdminIdentity();
  if (identity.mfa === "enroll") redirect("/mfa/setup");
  if (identity.mfa === "verify") redirect("/mfa");
  return { ...identity, permissions: permissionsFor(identity.role) };
});

/** For the authenticator pages only: the Admin identity without the AAL2 requirement. */
export async function requireAdminIdentity(): Promise<AdminIdentity> {
  return loadAdminIdentity();
}

/**
 * Server-side gate for every Admin page, data read and Server Action. With a permission, the
 * member's role must grant it. Server Actions and Route Handlers are not part of a render, so React's
 * cache does not apply there and every call runs the full check.
 */
export async function requireAdmin(permission?: Permission): Promise<AdminContext> {
  const context = await loadAdminContext();
  if (permission && !can(context.role, permission)) redirect(`/access?state=forbidden&need=${encodeURIComponent(permission)}`);
  return context;
}
