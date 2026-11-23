import type { ComponentType } from "react";
import type { FilmOverlayProps } from "./compositions";

/**
 * The welcome film's DOM overlay ("Welcome, <first name>"), drawn over the video by FilmVideo. Null until the
 * integrator sets it to film-welcome's `WelcomeOverlay` (BRIEF-2 6.1b); the reveal itself is LogoReveal "film-end",
 * which WelcomeFilm mounts, not the overlay.
 */
export const WELCOME_FILM_OVERLAY: ComponentType<FilmOverlayProps> | null = null;
