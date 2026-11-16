// Admin session rules: an authenticator app (Supabase AAL2) and a maximum session age.
// No imports, so tests can load this file directly.

/** An Admin session ends this many hours after its Google sign-in, however active it is. */
export const ADMIN_MAX_SESSION_HOURS = 12;
export const ADMIN_MAX_SESSION_SECONDS = ADMIN_MAX_SESSION_HOURS * 60 * 60;

export type SessionDecision =
  | { state: "ok"; signedInAt: number }
  | { state: "expired"; signedInAt: number | null }
  | { state: "enroll"; signedInAt: number }
  | { state: "verify"; signedInAt: number };

/**
 * When this session signed in, in Unix seconds. Supabase puts every authentication method used in
 * the session in the access token's `amr` claim with its time, and keeps them across token
 * refreshes, so the earliest one is the sign-in. Falls back to the token's issue time.
 */
export function sessionSignedInAt(amr: unknown, issuedAt?: unknown): number | null {
  const stamps = Array.isArray(amr)
    ? amr
        .map((entry) => (entry && typeof entry === "object" ? Number((entry as { timestamp?: unknown }).timestamp) : NaN))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];
  if (stamps.length) return Math.min(...stamps);
  const issued = Number(issuedAt);
  return Number.isFinite(issued) && issued > 0 ? issued : null;
}

/**
 * What an Admin request must do next: carry on, sign in again because the session is too old,
 * set up an authenticator app, or enter its code.
 */
export function evaluateAdminSession({
  aal,
  amr,
  issuedAt,
  hasVerifiedFactor,
  nowSeconds,
  maxAgeSeconds = ADMIN_MAX_SESSION_SECONDS,
}: {
  aal: unknown;
  amr: unknown;
  issuedAt?: unknown;
  hasVerifiedFactor: boolean;
  nowSeconds: number;
  maxAgeSeconds?: number;
}): SessionDecision {
  const signedInAt = sessionSignedInAt(amr, issuedAt);
  if (signedInAt === null || nowSeconds - signedInAt > maxAgeSeconds) return { state: "expired", signedInAt };
  if (!hasVerifiedFactor) return { state: "enroll", signedInAt };
  if (aal !== "aal2") return { state: "verify", signedInAt };
  return { state: "ok", signedInAt };
}

/** A six-digit authenticator code, with spaces allowed while typing. Returns the digits or null. */
export function normaliseTotpCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}
