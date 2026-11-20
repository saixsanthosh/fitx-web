"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminSession, revokeCurrentSession, rootCredentials } from "@/lib/admin-session";
import { logAdminEvent } from "@/lib/audit";
import { logServerError, logServerWarning } from "@/lib/log";
import {
  auditIpLimited,
  checkLoginAllowed,
  clientIpKey,
  LOGIN_FAILURE_MESSAGE,
  recordLoginResult,
  verifyAgainstDummy,
  waitOutFailure,
} from "@/lib/login-guard";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "@/lib/password";
import { isConsolePath } from "@/lib/roles";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normaliseUsername } from "@/lib/username";

export type LoginState = { error: string | null; username: string } | null;

type Candidate = { id: string | null; isRoot: boolean; passwordHash: string | null; mustChangePassword: boolean };

/** Who a username belongs to: the root (from the environment), an active operator, or nobody. */
async function findCandidate(username: string): Promise<Candidate | null | "unavailable"> {
  const root = rootCredentials();
  if (root && username === root.username) return { id: null, isRoot: true, passwordHash: root.passwordHash, mustChangePassword: false };
  const admin = createAdminSupabase();
  if (!admin) return "unavailable";
  const { data, error } = await admin
    .from("admin_operators")
    .select("id,is_active,is_root,password_hash,must_change_password")
    .eq("username", username)
    .maybeSingle<{ id: string; is_active: boolean; is_root: boolean; password_hash: string | null; must_change_password: boolean }>();
  if (error) {
    logServerError("login.find_operator", error);
    return "unavailable";
  }
  // A root row whose name is no longer FITX_ADMIN_USERNAME cannot sign in with a stored password.
  if (!data || data.is_root || !data.is_active || !data.password_hash) return null;
  return { id: data.id, isRoot: false, passwordHash: data.password_hash, mustChangePassword: data.must_change_password };
}

/** The operator ID a typed username belongs to, for audit rows (null for anyone else). */
async function operatorIdFor(username: string | null): Promise<string | null> {
  if (!username) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data } = await admin.from("admin_operators").select("id").eq("username", username).maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/**
 * Username and password sign-in (no Google). Every failure, whatever the cause, gives the same message
 * after 400 to 700 ms in total. Locked usernames and limited IPs are refused before the password is
 * checked. Fails closed: no server key, no root environment variables or no migration means no sign-in.
 */
export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const startedAt = Date.now();
  const typed = typeof formData.get("username") === "string" ? String(formData.get("username")).trim().slice(0, 64) : "";
  const passwordValue = formData.get("password");
  const password = typeof passwordValue === "string" && passwordValue.length <= MAX_PASSWORD_LENGTH ? passwordValue : "";
  const next = formData.get("next");
  const username = normaliseUsername(typed);
  const requestHeaders = await headers();
  const ipKey = clientIpKey(requestHeaders);

  const fail = async (): Promise<LoginState> => {
    await waitOutFailure(startedAt);
    return { error: LOGIN_FAILURE_MESSAGE, username: typed };
  };

  if (!createAdminSupabase()) {
    logServerWarning("login", "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not set, so every sign-in is refused");
    return fail();
  }
  if (!rootCredentials()) {
    logServerWarning("login", "FITX_ADMIN_USERNAME or FITX_ADMIN_PASSWORD_HASH is missing or malformed, so every sign-in is refused");
    return fail();
  }

  const check = await checkLoginAllowed(username ?? typed.toLowerCase(), ipKey);
  if (check === "ip_limited") {
    await auditIpLimited(ipKey);
    return fail();
  }
  if (check !== "ok") return fail();

  const candidate = username && password ? await findCandidate(username) : null;
  if (candidate === "unavailable") {
    await recordLoginResult(username ?? typed.toLowerCase(), ipKey, false);
    return fail();
  }
  const verified = candidate?.passwordHash ? await verifyPassword(password, candidate.passwordHash) : await verifyAgainstDummy(password);

  if (!verified || !candidate || !username) {
    const recorded = await recordLoginResult(username ?? typed.toLowerCase(), ipKey, false);
    // A typed username is recorded only when it belongs to an operator.
    const operatorId = await operatorIdFor(username);
    if (operatorId) {
      await logAdminEvent({ actor: null, action: "admin_login_failed", resourceType: "admin_operator", resourceId: operatorId, details: { username } });
      if (recorded === "locked_now") {
        await logAdminEvent({ actor: null, action: "admin_login_locked", resourceType: "admin_operator", resourceId: operatorId, details: { username } });
      }
    } else if (recorded === "locked_now" && candidate?.isRoot) {
      await logAdminEvent({ actor: null, action: "admin_login_locked", resourceType: "admin_operator", details: { username } });
    }
    return fail();
  }

  const admin = createAdminSupabase();
  if (!admin) return fail();
  let operatorId = candidate.id;
  if (candidate.isRoot) {
    const synced = await admin.rpc("fitx_admin_op_root_sign_in", { p_username: username });
    if (synced.error || typeof synced.data !== "string") {
      logServerError("login.root_sync", synced.error);
      await recordLoginResult(username, ipKey, false);
      return fail();
    }
    operatorId = synced.data;
  } else if (operatorId) {
    const marked = await admin.rpc("fitx_admin_op_mark_signed_in", { p_operator_id: operatorId });
    if (marked.error) logServerError("login.mark_signed_in", marked.error);
  }
  if (!operatorId) return fail();

  const session = await createAdminSession(operatorId, { ipKey, userAgent: requestHeaders.get("user-agent") });
  if (!session.ok) {
    await recordLoginResult(username, ipKey, false);
    return fail();
  }
  await recordLoginResult(username, ipKey, true);
  await logAdminEvent({ actor: { id: operatorId }, action: "admin_login_succeeded", resourceType: "admin_session", resourceId: session.sessionId, details: { root: candidate.isRoot } });
  redirect(candidate.mustChangePassword ? "/account" : isConsolePath(next) ? next : "/overview");
}

/** Ends this browser's Admin session, removes the cookie and goes to /login. */
export async function signOut(): Promise<never> {
  const ended = await revokeCurrentSession("signed_out");
  if (ended) await logAdminEvent({ actor: { id: ended.operatorId }, action: "admin_signed_out", resourceType: "admin_session", resourceId: ended.sessionId });
  redirect("/login");
}
