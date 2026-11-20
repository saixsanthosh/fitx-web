import "server-only";
import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { readSessionOperator } from "@/lib/admin-session";
import { permissionsFor, type AdminRole, type Permission } from "@/lib/roles";

/** The signed-in Admin operator, as every page, data helper, Server Action and Route Handler sees it. */
export type AdminOperator = {
  id: string;
  username: string;
  role: AdminRole;
  sessionId: string;
  isRoot: boolean;
  permissions: readonly Permission[];
  /** A temporary password from a super-admin: only /account (change password) opens until it is changed. */
  mustChangePassword: boolean;
};

/** One session check per render (React cache); Server Actions and Route Handlers run it on every call. */
const loadOperator = cache(async (): Promise<AdminOperator | null> => {
  const session = await readSessionOperator();
  if (!session) return null;
  const { operator } = session;
  return {
    id: operator.id,
    username: operator.username,
    role: operator.role,
    sessionId: session.sessionId,
    isRoot: operator.isRoot,
    permissions: permissionsFor(operator.role),
    mustChangePassword: operator.mustChangePassword,
  };
});

/** For the login page: who is signed in, or null. Never redirects. */
export async function getAdminOperator(): Promise<AdminOperator | null> {
  return loadOperator();
}

/** True when the operator's role grants the permission. */
export function hasPermission(operator: Pick<AdminOperator, "permissions">, permission: Permission): boolean {
  return operator.permissions.includes(permission);
}

/**
 * The server-side gate. No valid session: to /login. With a permission: an operator who must change a
 * temporary password goes to /account, and a role without the permission gets the 403 page
 * (forbidden(), src/app/forbidden.tsx). The layout is never the only guard: call this first everywhere.
 */
export async function requireAdmin(permission?: Permission): Promise<AdminOperator> {
  const operator = await loadOperator();
  if (!operator) redirect("/login");
  if (permission) {
    if (operator.mustChangePassword) redirect("/account");
    if (!hasPermission(operator, permission)) forbidden();
  }
  return operator;
}
