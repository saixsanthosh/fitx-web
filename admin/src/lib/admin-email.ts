// Pure allowlist rules for Admin sign-in. No imports, so tests can load this file directly.

type IdentityLike = {
  provider?: string | null;
  identity_data?: Record<string, unknown> | null;
};

export type AdminEmailUser = {
  email?: string | null;
  email_confirmed_at?: string | null;
  identities?: ReadonlyArray<IdentityLike> | null;
};

export type AdminEmailCheck =
  | { ok: true; email: string }
  | { ok: false; reason: "unconfirmed_email" | "no_verified_google_identity" | "not_allowlisted" };

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Reads FITX_ADMIN_ALLOWED_EMAILS: emails separated by commas, semicolons, spaces or new lines. */
export function parseAllowlist(value: string | null | undefined): ReadonlySet<string> {
  const emails = new Set<string>();
  for (const entry of (value ?? "").split(/[\s,;]+/)) {
    const email = normaliseEmail(entry);
    if (email) emails.add(email);
  }
  return emails;
}

function isVerified(value: unknown) {
  return value === true || value === "true";
}

/**
 * The signed-in account passes only when its confirmed email belongs to a verified
 * Google identity on the same account and that email is on the allowlist.
 */
export function checkAdminEmail(user: AdminEmailUser, allowlist: ReadonlySet<string>): AdminEmailCheck {
  const email = normaliseEmail(user.email);
  if (!email || !user.email_confirmed_at) return { ok: false, reason: "unconfirmed_email" };

  const hasVerifiedGoogleIdentity = (user.identities ?? []).some((identity) =>
    identity.provider === "google" &&
    normaliseEmail(identity.identity_data?.email) === email &&
    isVerified(identity.identity_data?.email_verified),
  );
  if (!hasVerifiedGoogleIdentity) return { ok: false, reason: "no_verified_google_identity" };

  if (!allowlist.has(email)) return { ok: false, reason: "not_allowlisted" };
  return { ok: true, email };
}
