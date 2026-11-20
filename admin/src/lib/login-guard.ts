import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { logAdminEvent } from "@/lib/audit";
import { logServerError, logServerWarning } from "@/lib/log";
import { hashPassword, verifyPassword } from "@/lib/password";
import { isMissingSchema, MIGRATIONS } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Sign-in limits, mirrored in fitx_admin_login_limits() (20261121100030_fitx_admin_v2): 5 failures for
 * one username from one client IP in 15 minutes lock that username on that IP for 15 minutes from the
 * fifth (the root too), so another network still works; at most 20 attempts of any kind per client IP
 * in 15 minutes. Attempts during a lock are refused without checking the password and do not extend it.
 */
export const LOGIN_LIMITS = { userFailures: 5, userWindowMinutes: 15, lockMinutes: 15, ipAttempts: 20, ipWindowMinutes: 15 } as const;

/**
 * The lock across every IP, mirrored in fitx_admin_login_username_limits(): 50 failures for one username
 * from any IPs in 15 minutes lock it on every IP for 5 minutes from the fiftieth.
 */
export const USERNAME_LOGIN_LIMITS = { usernameFailures: 50, usernameWindowMinutes: 15, usernameLockMinutes: 5 } as const;

/** The only failure text the sign-in page ever shows, whatever the cause. */
export const LOGIN_FAILURE_MESSAGE = "Those sign-in details did not work. Wait a few minutes and try again.";

/** Every failed sign-in takes this long in total, so timing does not tell one cause from another. */
export const LOGIN_FAILURE_DELAY_MS = { min: 400, max: 700 } as const;

/**
 * The client IP as a key: x-real-ip, else the first x-forwarded-for entry, else "unknown", then an
 * HMAC-SHA256 keyed with FITX_ADMIN_PASSWORD_HASH in base64url. No raw IP is stored or logged.
 */
export function clientIpKey(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (real || forwarded || "unknown").slice(0, 100);
  return createHmac("sha256", process.env.FITX_ADMIN_PASSWORD_HASH ?? "").update(ip).digest("base64url");
}

/** How long a failure takes in total: 400 to 700 ms. */
export function failureDelayMs(random: () => number = Math.random): number {
  const { min, max } = LOGIN_FAILURE_DELAY_MS;
  return Math.round(min + Math.min(Math.max(random(), 0), 1) * (max - min));
}

/** Waits until the failure's total time since `startedAt` reaches its delay. */
export async function waitOutFailure(startedAt: number, random: () => number = Math.random): Promise<void> {
  const remaining = failureDelayMs(random) - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

let dummyHash: Promise<string> | null = null;

/** One scrypt check against a random hash, so an unknown username costs as long as a known one. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64url"));
  await verifyPassword(password || "x", await dummyHash);
  return false;
}

export type LoginCheck = "ok" | "locked" | "ip_limited" | "unavailable";
export type LoginRecord = "recorded" | "locked_now" | "unavailable";

function unavailable(scope: string, error: unknown) {
  if (isMissingSchema(error)) logServerWarning(scope, `sign-in is refused until migration ${MIGRATIONS.adminV2} is applied`);
  else logServerError(scope, error);
}

/** Before the password is checked. Anything but "ok" refuses the sign-in (fail closed). */
export async function checkLoginAllowed(username: string, ipKey: string): Promise<LoginCheck> {
  const admin = createAdminSupabase();
  if (!admin) return "unavailable";
  const { data, error } = await admin.rpc("fitx_admin_login_check", { p_username: username.slice(0, 200), p_ip_key: ipKey });
  if (error) {
    unavailable("login.check", error);
    return "unavailable";
  }
  return data === "ok" || data === "locked" || data === "ip_limited" ? data : "unavailable";
}

/** After the password check; "locked_now" when this failure locked the username. */
export async function recordLoginResult(username: string, ipKey: string, succeeded: boolean): Promise<LoginRecord> {
  const admin = createAdminSupabase();
  if (!admin) return "unavailable";
  const { data, error } = await admin.rpc("fitx_admin_login_record", { p_username: username.slice(0, 200), p_ip_key: ipKey, p_succeeded: succeeded });
  if (error) {
    unavailable("login.record", error);
    return "unavailable";
  }
  return data === "locked_now" ? "locked_now" : "recorded";
}

/** Audits an IP reaching its limit, at most once per IP key and window, so a flood cannot fill the log. */
export async function auditIpLimited(ipKey: string): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) return;
  const since = new Date(Date.now() - LOGIN_LIMITS.ipWindowMinutes * 60_000).toISOString();
  const { data, error } = await admin
    .from("fitx_admin_audit_logs")
    .select("id")
    .eq("action", "admin_login_ip_limited")
    .eq("details->>ip_key", ipKey)
    .gte("created_at", since)
    .limit(1);
  if (error) {
    logServerError("login.ip_limited_lookup", error);
    return;
  }
  if ((data ?? []).length) return;
  await logAdminEvent({ actor: null, action: "admin_login_ip_limited", resourceType: "admin_session", details: { ip_key: ipKey, limit: LOGIN_LIMITS.ipAttempts, window_minutes: LOGIN_LIMITS.ipWindowMinutes } });
}
