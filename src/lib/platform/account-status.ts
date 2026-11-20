// A suspended FITX account, as sign-in sees it. Admin suspends an account by banning it in Supabase Auth,
// which then refuses sign-in and token refresh with the error code "user_banned".
import { BRAND } from "@/config/brand";

export const SUSPENDED_MESSAGE = `This account is suspended. Email ${BRAND.supportEmail} if you think this is a mistake.`;

/**
 * True for Supabase Auth's "user_banned": an AuthError (code), an object with error_code, the code itself,
 * or the query string / URLSearchParams of an OAuth callback that carries error_code=user_banned.
 */
export function isSuspendedError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") {
    if (error === "user_banned") return true;
    if (error.includes("=")) {
      try {
        return new URLSearchParams(error.startsWith("?") ? error.slice(1) : error).get("error_code") === "user_banned";
      } catch {
        return false;
      }
    }
    return false;
  }
  if (error instanceof URLSearchParams) return error.get("error_code") === "user_banned";
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    return record.code === "user_banned" || record.error_code === "user_banned";
  }
  return false;
}
