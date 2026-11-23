"use client";

import type { FilmOverlayProps } from "../compositions";
import { welcomeGreeting } from "./overlay-plan";
import styles from "./WelcomeOverlay.module.css";

/**
 * The welcome film's overlay (BRIEF-2 3.3): "Welcome, <first name>" from the profile, rising under the reveal's
 * lockup once it has formed, and nothing at all when there is no first name. The reveal itself
 * (`LogoReveal variant="film-end"`) is WelcomeFilm's. Mounted by `FilmVideo` through `WELCOME_FILM_OVERLAY`
 * (the integrator sets it in 6.1b); it hears the film clock at 4 Hz and on every stage change.
 *
 * Transform and opacity only; with reduced motion the line appears without moving (WelcomeFilm shows its still
 * instead of the film then, so this is a second guard). It never takes a pointer or the focus.
 */
export function WelcomeOverlay({ film, time, held, firstName }: FilmOverlayProps) {
  if (film !== "welcome") return null;
  const greeting = welcomeGreeting({ firstName, time, held });
  if (!greeting.text) return null;
  return (
    <div className={styles.zone} data-welcome-overlay="" aria-hidden={greeting.visible ? undefined : true}>
      <p className={`${styles.line} ${greeting.visible ? styles.shown : ""}`}>{greeting.text}</p>
    </div>
  );
}

export default WelcomeOverlay;
