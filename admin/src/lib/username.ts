// Admin operator usernames. No imports, so tests can load this file directly.
// The same rule is the check on public.admin_operators.username (20261121100030_fitx_admin_v2).

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** A username in lower case without surrounding spaces, or null when it breaks the rule. */
export function normaliseUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  return USERNAME_PATTERN.test(name) ? name : null;
}
