import { safeNext } from "./safe-next";

/**
 * The app pages a signed-in account that has not finished setting up FITX may open: onboarding itself,
 * and Help, so anyone signed in can ask the FITX team for help (for example when setup keeps failing).
 * Every other app page sends such an account back to onboarding (src/proxy.ts), and so does signing in
 * (post-sign-in.ts). Exact paths only: nothing below them opens.
 *
 * Deleting an account that was created with the wrong Google account needs nothing more: onboarding has
 * "Delete this account instead", its dialog talks to /api/account (never matched by the proxy), and
 * "Sign in again" signs out first, so the sign-in page is a signed-out page by then.
 */
export const OPEN_BEFORE_ONBOARDING: readonly string[] = ["/onboarding", "/help"];

export function openBeforeOnboarding(pathname: string): boolean {
  return OPEN_BEFORE_ONBOARDING.includes(pathname);
}

/** Where an account still in setup goes after signing in: the page it asked for when that page is open to it, else onboarding. */
export function destinationBeforeOnboarding(requestedNext: string | null | undefined): string {
  const next = safeNext(requestedNext, "/onboarding");
  return openBeforeOnboarding(next.split(/[?#]/)[0]) ? next : "/onboarding";
}
