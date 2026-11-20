// Admin session rules. No imports, so tests can load this file directly.

/** The httpOnly cookie that carries an Admin session token. __Host- means Secure, Path=/ and no Domain. */
export const ADMIN_SESSION_COOKIE = "__Host-fitx_admin";
/** A session ends this long after sign-in, however active it is. */
export const ADMIN_SESSION_ABSOLUTE_HOURS = 12;
/** A session ends after this long without a request. */
export const ADMIN_SESSION_IDLE_MINUTES = 60;
/** last_seen_at is written at most this often. */
export const ADMIN_SESSION_TOUCH_SECONDS = 60;
/** Token bytes before base64url (43 characters). */
export const ADMIN_SESSION_TOKEN_BYTES = 32;

export type SessionState = "ok" | "expired" | "idle" | "revoked";

function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") return new Date(value).getTime();
  return Number.NaN;
}

/** Whether a stored session may still be used. Unreadable times count as expired. */
export function evaluateSessionRow({ createdAt, lastSeenAt, revokedAt, nowMs }: {
  createdAt: unknown;
  lastSeenAt: unknown;
  revokedAt: unknown;
  nowMs: number;
}): SessionState {
  if (revokedAt !== null && revokedAt !== undefined) return "revoked";
  const created = toMs(createdAt);
  const seen = toMs(lastSeenAt);
  if (!Number.isFinite(created) || !Number.isFinite(seen) || created > nowMs + 60_000) return "expired";
  if (nowMs - created >= ADMIN_SESSION_ABSOLUTE_HOURS * 3_600_000) return "expired";
  if (nowMs - Math.max(seen, created) >= ADMIN_SESSION_IDLE_MINUTES * 60_000) return "idle";
  return "ok";
}

/** True when last_seen_at is old enough to write again. */
export function shouldTouchSession(lastSeenAt: unknown, nowMs: number): boolean {
  const seen = toMs(lastSeenAt);
  return !Number.isFinite(seen) || nowMs - seen >= ADMIN_SESSION_TOUCH_SECONDS * 1000;
}

/** A session token as the cookie carries it: 32 random bytes in base64url, 43 characters. */
export function isSessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Cookie settings for the session cookie. Always Secure: browsers accept that on http://localhost too. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: ADMIN_SESSION_ABSOLUTE_HOURS * 3600,
  };
}

/**
 * Settings that remove the session cookie. A __Host- cookie is only replaced when the new one is
 * Secure with Path=/ too, so this keeps every flag of sessionCookieOptions() and expires it now.
 */
export function expiredSessionCookieOptions() {
  return { ...sessionCookieOptions(), maxAge: 0, expires: new Date(0) };
}

/** The user agent as stored: at most 300 characters, control characters removed. */
export function clipUserAgent(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 300);
  return clean || null;
}
