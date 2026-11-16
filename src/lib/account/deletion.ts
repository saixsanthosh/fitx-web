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
};

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
