import "server-only";
import { hasPermission, requireAdmin, type AdminOperator } from "@/lib/admin-auth";
import { createAdminSession, revokeOperatorSessions, rootCredentials } from "@/lib/admin-session";
import { logServerError } from "@/lib/log";
import { clientIpKey } from "@/lib/login-guard";
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword } from "@/lib/password";
import { isAdminRole, type AdminRole } from "@/lib/roles";
import { isMissingSchema, isPermissionError } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normaliseUsername } from "@/lib/username";

/** An Admin operator as the Access screen shows it. Never carries the password hash. */
export type Operator = {
  id: string;
  username: string;
  role: AdminRole;
  isActive: boolean;
  isRoot: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

export type OperatorError =
  | "forbidden"
  | "invalid_username"
  | "reserved_username"
  | "username_taken"
  | "invalid_role"
  | "weak_password"
  | "same_password"
  | "wrong_password"
  | "not_found"
  | "root_protected"
  | "self"
  | "unavailable"
  | "failed";

export type OperatorResult<T = undefined> = ({ ok: true } & (T extends undefined ? object : { value: T })) | { ok: false; error: OperatorError };

const COLUMNS = "id,username,role,is_active,is_root,must_change_password,created_at,last_login_at";

function toOperator(row: Record<string, unknown>): Operator | null {
  if (!isAdminRole(row.role)) return null;
  return {
    id: String(row.id),
    username: String(row.username),
    role: row.role,
    isActive: Boolean(row.is_active),
    isRoot: Boolean(row.is_root),
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: String(row.created_at),
    lastLoginAt: typeof row.last_login_at === "string" ? row.last_login_at : null,
  };
}

/** Maps a database refusal to an error code; logs anything unexpected. */
function refusal(scope: string, error: { code?: string; message?: string }): OperatorError {
  if (isMissingSchema(error)) return "unavailable";
  if (error.code === "23505") return "username_taken";
  if (error.code === "P0002") return "not_found";
  if (isPermissionError(error)) return error.message === "operator_root" ? "root_protected" : "forbidden";
  if (error.code === "22023") {
    if (error.message === "operator_self") return "self";
    if (error.message === "operator_same_password") return "same_password";
    if (error.message === "Invalid username") return "invalid_username";
    if (error.message === "Invalid Admin role") return "invalid_role";
  }
  logServerError(scope, error);
  return "failed";
}

function passwordProblem(password: unknown): OperatorError | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) return "weak_password";
  return null;
}

/** Every operator, the root first, then active ones by name. Needs access.view. */
export async function listOperators(): Promise<OperatorResult<Operator[]>> {
  await requireAdmin("access.view");
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: "unavailable" };
  const { data, error } = await admin
    .from("admin_operators")
    .select(COLUMNS)
    .order("is_root", { ascending: false })
    .order("is_active", { ascending: false })
    .order("username", { ascending: true })
    .limit(200);
  if (error) return { ok: false, error: refusal("operators.list", error) };
  const value = (data ?? []).map((row) => toOperator(row as Record<string, unknown>)).filter((row): row is Operator => row !== null);
  return { ok: true, value };
}

/**
 * Adds an operator with a temporary password (at least 12 characters); they set their own at first
 * sign-in. The root's username is refused. The database checks access.manage again and audits.
 */
export async function createOperator(actor: AdminOperator, input: { username: unknown; role: unknown; password: unknown }): Promise<OperatorResult<{ id: string }>> {
  if (!hasPermission(actor, "access.manage")) return { ok: false, error: "forbidden" };
  const username = normaliseUsername(input.username);
  if (!username) return { ok: false, error: "invalid_username" };
  const reserved = normaliseUsername(process.env.FITX_ADMIN_USERNAME);
  if (reserved && username === reserved) return { ok: false, error: "reserved_username" };
  if (!isAdminRole(input.role)) return { ok: false, error: "invalid_role" };
  const weak = passwordProblem(input.password);
  if (weak) return { ok: false, error: weak };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: "unavailable" };

  const passwordHash = await hashPassword(input.password as string);
  const { data, error } = await admin.rpc("fitx_admin_op_create_operator", {
    p_operator_id: actor.id,
    p_username: username,
    p_role: input.role,
    p_password_hash: passwordHash,
  });
  if (error) return { ok: false, error: refusal("operators.create", error) };
  return { ok: true, value: { id: String(data) } };
}

/** Changes another operator's role or status. Not the root, not yourself. Deactivating ends their sessions. */
export async function updateOperator(actor: AdminOperator, id: string, changes: { role?: unknown; isActive?: unknown }): Promise<OperatorResult> {
  if (!hasPermission(actor, "access.manage")) return { ok: false, error: "forbidden" };
  if (id === actor.id) return { ok: false, error: "self" };
  if (changes.role !== undefined && !isAdminRole(changes.role)) return { ok: false, error: "invalid_role" };
  if (changes.isActive !== undefined && typeof changes.isActive !== "boolean") return { ok: false, error: "failed" };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: "unavailable" };
  const { error } = await admin.rpc("fitx_admin_op_update_operator", {
    p_operator_id: actor.id,
    p_target_id: id,
    p_role: changes.role ?? null,
    p_is_active: changes.isActive ?? null,
  });
  if (error) return { ok: false, error: refusal("operators.update", error) };
  return { ok: true };
}

/** Gives another operator a new temporary password and ends their sessions. Not the root. */
export async function resetOperatorPassword(actor: AdminOperator, id: string, password: unknown): Promise<OperatorResult> {
  if (!hasPermission(actor, "access.manage")) return { ok: false, error: "forbidden" };
  if (id === actor.id) return { ok: false, error: "self" };
  const weak = passwordProblem(password);
  if (weak) return { ok: false, error: weak };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: "unavailable" };
  const { error } = await admin.rpc("fitx_admin_op_set_operator_password", {
    p_operator_id: actor.id,
    p_target_id: id,
    p_password_hash: await hashPassword(password as string),
    p_must_change: true,
  });
  if (error) return { ok: false, error: refusal("operators.reset_password", error) };
  return { ok: true };
}

/**
 * Changes your own password after checking the current one. Every session of yours ends, then this
 * browser gets a fresh one, so you stay signed in here only. The root's password lives in the
 * environment (npm run admin:hash), so the root cannot change it here. Server Actions only (it sets
 * the session cookie).
 */
export async function changeOwnPassword(actor: AdminOperator, current: unknown, next: unknown, context: { headers: Headers }): Promise<OperatorResult> {
  if (actor.isRoot) return { ok: false, error: "root_protected" };
  const weak = passwordProblem(next);
  if (weak) return { ok: false, error: weak };
  if (typeof current !== "string" || current === next) return { ok: false, error: typeof current !== "string" ? "wrong_password" : "same_password" };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: "unavailable" };
  const row = await admin.from("admin_operators").select("password_hash").eq("id", actor.id).maybeSingle<{ password_hash: string | null }>();
  if (row.error || !row.data) return { ok: false, error: row.error ? refusal("operators.own_lookup", row.error) : "not_found" };
  if (!(await verifyPassword(current, row.data.password_hash))) return { ok: false, error: "wrong_password" };

  const { error } = await admin.rpc("fitx_admin_op_set_operator_password", {
    p_operator_id: actor.id,
    p_target_id: actor.id,
    p_password_hash: await hashPassword(next as string),
    p_must_change: false,
  });
  if (error) return { ok: false, error: refusal("operators.change_password", error) };
  // The database already ended every session; this makes sure, then signs this browser in again.
  await revokeOperatorSessions(actor.id, "password_changed");
  const session = await createAdminSession(actor.id, {
    ipKey: clientIpKey(context.headers),
    userAgent: context.headers.get("user-agent"),
  });
  return session.ok ? { ok: true } : { ok: false, error: "failed" };
}

/** True when the root's environment variables are set and well formed (values never shown). */
export function rootConfigured(): boolean {
  return rootCredentials() !== null;
}
