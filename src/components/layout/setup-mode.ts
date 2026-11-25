import { OPEN_BEFORE_ONBOARDING } from "@/lib/auth/before-onboarding";

/**
 * Setup mode (bug 35). An account still in setup may open Help, and only Help, besides setup itself
 * (src/lib/auth/before-onboarding.ts). There the app's menu, its account menu and the AI Coach button would each
 * lead back to step 1 of setup with no word why, since the proxy sends every other page to /onboarding. So in
 * setup mode the shell hides them and offers one way back instead: "Back to setup" (SetupMode.tsx, globals.css).
 *
 * Pure, for tests.
 */
export const SETUP_PATH = "/onboarding";

/** A page an account in setup may open, other than setup itself: Help. */
export function openDuringSetup(pathname: string): boolean {
  return pathname !== SETUP_PATH && OPEN_BEFORE_ONBOARDING.includes(pathname);
}

/** True when the page was opened from setup: its "Get help" links carry ?from=/onboarding. */
export function cameFromSetup(from: string | null | undefined): boolean {
  return typeof from === "string" && from.split(/[?#]/)[0] === SETUP_PATH;
}

/**
 * Whether the account has finished setup, from the shared user context: true or false once its profile has loaded
 * (no profile row counts as not finished, as in the proxy), null while it loads or when it could not be read.
 */
export function onboardedFrom(context: { status: string; data: { profile: { onboarded: boolean } | null } | null } | null): boolean | null {
  if (!context || context.status !== "ready" || !context.data) return null;
  return context.data.profile?.onboarded === true;
}

/**
 * Setup mode is on for a page open during setup while the account is known to be in setup; until the account has
 * loaded, the link it came by decides, so a page opened from setup never shows the app's menu first.
 */
export function inSetupMode({ pathname, from, onboarded }: { pathname: string; from: string | null; onboarded: boolean | null }): boolean {
  if (!openDuringSetup(pathname)) return false;
  return onboarded === null ? cameFromSetup(from) : !onboarded;
}
