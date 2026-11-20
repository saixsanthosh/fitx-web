import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireAdmin, type AdminOperator } from "@/lib/admin-auth";
import { logAdminEvent } from "@/lib/audit";
import { logServerError, logServerWarning } from "@/lib/log";
import { parsePasswordHash } from "@/lib/password";
import { isAdminRole, type AdminRole } from "@/lib/roles";
import { isMissingSchema, MIGRATIONS } from "@/lib/schema";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TOKEN_BYTES,
  clipUserAgent,
  evaluateSessionRow,
  isSessionToken,
  sessionCookieOptions,
  shouldTouchSession,
  type SessionState,
} from "@/lib/session-policy";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normaliseUsername } from "@/lib/username";

export { ADMIN_SESSION_ABSOLUTE_HOURS, ADMIN_SESSION_COOKIE, ADMIN_SESSION_IDLE_MINUTES, evaluateSessionRow } from "@/lib/session-policy";

/** SHA-256 (hex) of a session token: what the database keeps instead of the token. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 16 hex characters of the SHA-256 of a password hash. A new password gives a new stamp. */
export function credentialStamp(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

export function newSessionToken(): string {
  return randomBytes(ADMIN_SESSION_TOKEN_BYTES).toString("base64url");
}

/** The root's name and hash from the environment, or null when either is missing or malformed. */
export function rootCredentials(): { username: string; passwordHash: string } | null {
  const username = normaliseUsername(process.env.FITX_ADMIN_USERNAME);
  const passwordHash = process.env.FITX_ADMIN_PASSWORD_HASH?.trim() ?? "";
  if (!username || !parsePasswordHash(passwordHash)) return null;
  return { username, passwordHash };
}

type OperatorRow = {
  id: string;
  username: string;
  role: string;
  is_active: boolean;
  is_root: boolean;
  password_hash: string | null;
  must_change_password: boolean;
};

const OPERATOR_COLUMNS = "id,username,role,is_active,is_root,password_hash,must_change_password";

/** The password hash an operator signs in with now: the environment's for the root, the row's for others. */
function hashInUse(row: Pick<OperatorRow, "is_root" | "password_hash" | "username">): string | null {
  if (row.is_root) {
    const root = rootCredentials();
    return root && root.username === row.username ? root.passwordHash : null;
  }
  return row.password_hash && parsePasswordHash(row.password_hash) ? row.password_hash : null;
}

export type SessionOperator = {
  sessionId: string;
  operator: { id: string; username: string; role: AdminRole; isRoot: boolean; mustChangePassword: boolean };
};

/**
 * Starts a session after a successful sign-in: a new random token every time, its hash and the
 * credential stamp in admin_web_sessions, and the token in the httpOnly cookie. Server Actions only.
 */
export async function createAdminSession(operatorId: string, { ipKey, userAgent }: { ipKey: string | null; userAgent: string | null }): Promise<{ ok: true; sessionId: string } | { ok: false }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false };
  const operator = await admin.from("admin_operators").select(OPERATOR_COLUMNS).eq("id", operatorId).maybeSingle<OperatorRow>();
  if (operator.error || !operator.data || !operator.data.is_active) {
    if (operator.error) logServerError("session.create_operator", operator.error);
    return { ok: false };
  }
  const passwordHash = hashInUse(operator.data);
  if (!passwordHash) return { ok: false };

  const token = newSessionToken();
  const { data, error } = await admin
    .from("admin_web_sessions")
    .insert({
      operator_id: operatorId,
      token_hash: hashSessionToken(token),
      credential_stamp: credentialStamp(passwordHash),
      ip_key: ipKey ? ipKey.slice(0, 64) : null,
      user_agent: clipUserAgent(userAgent),
    })
    .select("id")
    .single();
  if (error || !data) {
    logServerError("session.create", error);
    return { ok: false };
  }
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, token, sessionCookieOptions());
  return { ok: true, sessionId: String(data.id) };
}

async function markEnded(sessionId: string, reason: string) {
  const admin = createAdminSupabase();
  if (!admin) return;
  const { error } = await admin
    .from("admin_web_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq("id", sessionId)
    .is("revoked_at", null);
  if (error) logServerError("session.mark_ended", error);
}

/**
 * The session in this request's cookie, if it is valid: not revoked, under 12 hours old, used in the
 * last 60 minutes, its operator active, and its credential stamp still that of the password in use.
 * admin-auth.ts calls this once per render; nothing else should.
 */
export async function readSessionOperator(): Promise<SessionOperator | null> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!isSessionToken(token)) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;

  const { data, error } = await admin
    .from("admin_web_sessions")
    .select(`id,credential_stamp,created_at,last_seen_at,revoked_at,admin_operators!inner(${OPERATOR_COLUMNS})`)
    .eq("token_hash", hashSessionToken(token))
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) logServerWarning("session.read", `Admin sessions need migration ${MIGRATIONS.adminV2}`);
    else logServerError("session.read", error);
    return null;
  }
  if (!data) return null;
  const row = data as unknown as {
    id: string; credential_stamp: string; created_at: string; last_seen_at: string; revoked_at: string | null;
    admin_operators: OperatorRow | OperatorRow[] | null;
  };
  const operator = Array.isArray(row.admin_operators) ? row.admin_operators[0] : row.admin_operators;
  const nowMs = Date.now();
  const state = evaluateSessionRow({ createdAt: row.created_at, lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at, nowMs });
  if (state !== "ok") {
    if (state !== "revoked") await markEnded(row.id, state);
    return null;
  }
  if (!operator || !operator.is_active || !isAdminRole(operator.role)) return null;
  const passwordHash = hashInUse(operator);
  if (!passwordHash || credentialStamp(passwordHash) !== row.credential_stamp) {
    await markEnded(row.id, "credentials_changed");
    return null;
  }
  if (shouldTouchSession(row.last_seen_at, nowMs)) {
    const touched = await admin.from("admin_web_sessions").update({ last_seen_at: new Date(nowMs).toISOString() }).eq("id", row.id).is("revoked_at", null);
    if (touched.error) logServerError("session.touch", touched.error);
  }
  return {
    sessionId: row.id,
    operator: {
      id: operator.id,
      username: operator.username,
      role: operator.role,
      isRoot: operator.is_root,
      mustChangePassword: operator.must_change_password,
    },
  };
}

/** Ends this browser's session and removes its cookie. Server Actions and Route Handlers only. */
export async function revokeCurrentSession(reason: string): Promise<{ sessionId: string; operatorId: string } | null> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  store.delete(ADMIN_SESSION_COOKIE);
  if (!isSessionToken(token)) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data, error } = await admin
    .from("admin_web_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason.slice(0, 120) || "signed_out" })
    .eq("token_hash", hashSessionToken(token))
    .is("revoked_at", null)
    .select("id,operator_id");
  if (error) {
    logServerError("session.revoke_current", error);
    return null;
  }
  const row = (data ?? [])[0];
  return row ? { sessionId: String(row.id), operatorId: String(row.operator_id) } : null;
}

/** Ends every open session of an operator; the number ended. */
export async function revokeOperatorSessions(operatorId: string, reason: string): Promise<number> {
  const admin = createAdminSupabase();
  if (!admin) return 0;
  const { data, error } = await admin.rpc("fitx_admin_op_end_sessions", { p_target_id: operatorId, p_reason: reason.slice(0, 120) });
  if (error) {
    logServerError("session.revoke_operator", error);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

export type RevokeSessionResult = { ok: true } | { ok: false; error: "forbidden" | "not_found" | "failed" };

/**
 * Ends one session: your own, or anyone's with access.manage (the root's only by the root). Audited.
 */
export async function revokeSessionById(actor: AdminOperator, id: string): Promise<RevokeSessionResult> {
  const admin = createAdminSupabase();
  if (!admin || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: admin ? "not_found" : "failed" };
  const found = await admin.from("admin_web_sessions").select("id,operator_id,revoked_at,admin_operators!inner(is_root)").eq("id", id).maybeSingle();
  if (found.error) {
    logServerError("session.revoke_lookup", found.error);
    return { ok: false, error: "failed" };
  }
  if (!found.data) return { ok: false, error: "not_found" };
  const target = found.data as unknown as { operator_id: string; revoked_at: string | null; admin_operators: { is_root: boolean } | Array<{ is_root: boolean }> };
  const targetIsRoot = Array.isArray(target.admin_operators) ? Boolean(target.admin_operators[0]?.is_root) : Boolean(target.admin_operators?.is_root);
  const own = target.operator_id === actor.id;
  if (!own && (!actor.permissions.includes("access.manage") || (targetIsRoot && !actor.isRoot))) return { ok: false, error: "forbidden" };
  if (target.revoked_at) return { ok: true };
  await markEnded(id, own ? "ended_by_self" : "ended_by_operator");
  await logAdminEvent({ actor, action: "admin_session_revoked", resourceType: "admin_session", resourceId: id, details: { operator_id: target.operator_id, own } });
  return { ok: true };
}

export type AdminSessionRow = {
  id: string;
  operatorId: string;
  username: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  userAgent: string | null;
  state: SessionState;
  isCurrent: boolean;
};

/** Sessions, newest first, for the Security screen (security.view). Never returns tokens or hashes. */
export async function listAdminSessions({ operatorId, activeOnly = false, limit }: { operatorId?: string; activeOnly?: boolean; limit: number }): Promise<{ state: "ready"; sessions: AdminSessionRow[] } | { state: "service_key_missing" | "migration_pending" | "query_failed" }> {
  const actor = await requireAdmin("security.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };
  let query = admin
    .from("admin_web_sessions")
    .select("id,operator_id,created_at,last_seen_at,revoked_at,revoked_reason,user_agent,admin_operators(username)")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(Math.trunc(limit) || 1, 1), 200));
  if (operatorId) query = query.eq("operator_id", operatorId);
  if (activeOnly) query = query.is("revoked_at", null).gte("created_at", new Date(Date.now() - 12 * 3_600_000).toISOString());
  const { data, error } = await query;
  if (error) {
    if (isMissingSchema(error)) return { state: "migration_pending" };
    logServerError("session.list", error);
    return { state: "query_failed" };
  }
  const nowMs = Date.now();
  const sessions = (data ?? []).map((raw) => {
    const row = raw as unknown as {
      id: string; operator_id: string; created_at: string; last_seen_at: string; revoked_at: string | null; revoked_reason: string | null;
      user_agent: string | null; admin_operators: { username: string } | Array<{ username: string }> | null;
    };
    const owner = Array.isArray(row.admin_operators) ? row.admin_operators[0] : row.admin_operators;
    return {
      id: row.id,
      operatorId: row.operator_id,
      username: owner?.username ?? null,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
      revokedReason: row.revoked_reason,
      userAgent: row.user_agent,
      state: evaluateSessionRow({ createdAt: row.created_at, lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at, nowMs }),
      isCurrent: row.id === actor.sessionId,
    };
  });
  return { state: "ready", sessions: activeOnly ? sessions.filter((session) => session.state === "ok") : sessions };
}
