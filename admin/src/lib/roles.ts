export type AdminRole = "admin" | "super_admin";

export function isAdminRole(role: unknown): role is AdminRole {
  return role === "admin" || role === "super_admin";
}
