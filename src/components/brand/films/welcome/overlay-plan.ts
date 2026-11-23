/**
 * When and what `WelcomeOverlay` shows (BRIEF-2 3.3), kept pure so tests/brand/welcome-film.test.ts checks it without a
 * browser. The greeting is the member's first name from the profile, or nothing at all: no stand-in name, no
 * "Welcome to FITX" (the reveal's wordmark says FITX), and nothing while the film is held.
 *
 * Timing: the reveal (`LogoReveal variant="film-end"`, mounted by WelcomeFilm at 9.29 s) forms its mark in 1.44 s and
 * its wordmark rises from 1.0 s to 1.5 s, so the lockup is complete at about 10.8 s; the greeting rises under it then
 * and holds to the film's end (12.0 s), when WelcomeFilm fades its stage out.
 */

import { WELCOME_DURATION, WELCOME_REVEAL_AT } from "../../intro/films/welcome/timeline";

/** Film time the greeting starts to rise (s): just after the reveal's wordmark has settled. */
export const GREETING_AT = Math.round((WELCOME_REVEAL_AT + 1.55) * 100) / 100;
/** The longest name shown in full; longer names are cut at a word or letter with an ellipsis. */
export const GREETING_MAX_NAME = 24;

/** The first name as shown: trimmed, inner spaces collapsed, at most `GREETING_MAX_NAME` characters. Null when empty. */
export function greetingName(firstName: string | null | undefined): string | null {
  const name = (firstName ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  const letters = Array.from(name);
  if (letters.length <= GREETING_MAX_NAME) return name;
  return `${letters.slice(0, GREETING_MAX_NAME - 1).join("").trimEnd()}…`;
}

export type GreetingState = { text: string | null; visible: boolean };

/**
 * What the overlay shows at a film time. `text` is null when there is no name (the overlay renders nothing);
 * `visible` turns the rise on once the film clock reaches `GREETING_AT` (a hold stops that clock, so it changes nothing).
 */
export function welcomeGreeting({ firstName, time, held }: { firstName: string | null | undefined; time: number; held: boolean }): GreetingState {
  const name = greetingName(firstName);
  if (!name) return { text: null, visible: false };
  const due = Number.isFinite(time) && time >= GREETING_AT && time <= WELCOME_DURATION + 1;
  // The clock stops while the film is held (buffering), so a hold never shows the line early nor takes it down.
  void held;
  return { text: `Welcome, ${name}`, visible: due };
}
