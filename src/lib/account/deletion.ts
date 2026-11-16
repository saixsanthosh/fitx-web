/**
 * Shared rules for "Delete my account", used by the Settings screen and the /api/account route.
 * No secrets here: this module is safe in the browser bundle.
 */

/** Deleting needs a sign-in this recent, so an unlocked, forgotten session can't erase an account. */
export const RECENT_SIGN_IN_MINUTES = 15;
/** Typed by the user to confirm. */
export const DELETE_CONFIRMATION = "DELETE";

export type DeletionStatus = {
  /** False when the server has no SUPABASE_SECRET_KEY, so deletion can't run yet. */
  available: boolean;
  /** True when this session signed in within RECENT_SIGN_IN_MINUTES. */
  recentSignIn: boolean;
  /** When this session last signed in (seconds since 1970), if known. */
  signedInAt: number | null;
  windowMinutes: number;
  /** The account this session belongs to, as the server sees it (null when signed out). */
  userId: string | null;
  email: string | null;
};

/** sessionStorage key: which account a "sign in again" for deletion started from. */
export const DELETE_STARTED_FOR_KEY = "fitx_delete_for";

type AuthErrorLike = { name?: unknown; status?: unknown; __isAuthError?: unknown } | null | undefined;

/**
 * True when Supabase Auth itself could not answer (network failure or a 5xx), as opposed to an answer
 * that the session is invalid. An outage must never be treated as "signed out".
 */
export function isAuthOutage(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as AuthErrorLike;
  if (value?.name === "AuthRetryableFetchError") return true;
  return typeof value?.status === "number" && value.status >= 500;
}

/**
 * For the read-only status request: refuse what the browser marks as cross-site, but allow requests
 * that carry neither fetch metadata nor an Origin header (older Safari sends neither on a same-origin
 * GET). Other sites still can't read the answer, because no CORS headers are sent.
 */
export function isAllowedStatusRequest(headers: { get(name: string): string | null }, origin: string) {
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const sentOrigin = headers.get("origin");
  return !sentOrigin || sentOrigin === origin;
}

type AmrEntry = { method?: unknown; timestamp?: unknown };

/**
 * When this session's user last proved who they are: the newest `amr` timestamp in the access token
 * (it survives token refreshes and is per session), else the account's `last_sign_in_at`.
 */
export function sessionSignedInAt(claims: { amr?: unknown } | null | undefined, lastSignInAt?: string | null): number | null {
  const entries = Array.isArray(claims?.amr) ? (claims.amr as AmrEntry[]) : [];
  const stamps = entries.map((entry) => (typeof entry?.timestamp === "number" ? entry.timestamp : NaN)).filter(Number.isFinite);
  if (stamps.length) return Math.max(...stamps);
  const parsed = lastSignInAt ? Date.parse(lastSignInAt) : NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

export function isRecentSignIn(signedInAt: number | null, nowMs = Date.now(), windowMinutes = RECENT_SIGN_IN_MINUTES) {
  if (signedInAt === null) return false;
  const age = nowMs / 1000 - signedInAt;
  // A small allowance for clock skew between Supabase and this server.
  return age >= -120 && age <= windowMinutes * 60;
}
