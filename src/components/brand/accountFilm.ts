import { INTRO_COOKIE_NAME, readCookie } from "@/lib/onboarding/post-sequence";
import { filmSeenRecently } from "./films/welcome-runtime";
import { ACCOUNT_FILM_STARTED_KEY, INTRO_PENDING_EVENT } from "./introKeys";

type Events = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Calls `report` once the head script has opened the account's one-time film on this page (gate
 * "account", see introBootstrap.ts): at once when it already has, or when it does later, which is when a
 * tab that loaded hidden is first shown. Never for the signed-out visitor's film or a replay. Returns the
 * clean-up.
 */
export function whenAccountFilmOpens(
  report: () => void,
  root: Pick<HTMLElement, "dataset"> = document.documentElement,
  events: Events = window,
): () => void {
  const check = () => {
    if (root.dataset.fitxIntroGate !== "account") return false;
    delete root.dataset.fitxIntroGate;
    events.removeEventListener(INTRO_PENDING_EVENT, check);
    report();
    return true;
  };
  if (check()) return () => undefined;
  events.addEventListener(INTRO_PENDING_EVENT, check);
  return () => events.removeEventListener(INTRO_PENDING_EVENT, check);
}

/** What the head script leaves on `window` when it opened the account's film on this page. */
export type AccountFilmWindow = { __fitxAccountFilm?: string; localStorage: Pick<Storage, "getItem"> };

/**
 * True when another tab opened the account's film after this page did, so this page should not play it.
 * Pages that load in several tabs at the same moment can each open it before they see each other's claim
 * (ACCOUNT_FILM_STARTED_KEY); by the time the app starts the film they have, and only the latest claim plays.
 * False whenever that can't be told (no claim on this page, storage blocked).
 */
export function accountFilmClaimedElsewhere(target: AccountFilmWindow = window as unknown as AccountFilmWindow): boolean {
  const mine = target.__fitxAccountFilm;
  if (!mine) return false;
  let latest: string | null = null;
  try {
    latest = target.localStorage.getItem(ACCOUNT_FILM_STARTED_KEY);
  } catch {
    return false;
  }
  return latest !== null && latest !== mine;
}

/**
 * D1: the welcome film started on this device less than 7 days ago (FILM_SEEN_KEY) but the device still says
 * `fitx_intro=play`, so its /api/intro/complete did not get through (both tries failed). IntroCompletionReporter then
 * tries again on this app page load; the server's answer sets "seen", which ends the retries.
 */
export function welcomeReportPending(cookies: string, seen: string | null, now: number = Date.now()): boolean {
  return readCookie(cookies, INTRO_COOKIE_NAME) === "play" && filmSeenRecently(seen, now);
}
