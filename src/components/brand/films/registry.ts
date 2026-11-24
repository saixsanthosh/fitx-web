import type { ComponentType } from "react";
import type { FilmOverlayProps } from "./compositions";
import { WelcomeOverlay } from "./welcome/WelcomeOverlay";

/**
 * The welcome film's DOM overlay ("Welcome, <first name>"), drawn over the video by FilmVideo: film-welcome's
 * `WelcomeOverlay`, set by the integrator (BRIEF-2 6.1b). Only WelcomeFilm reads it, and only in its film case, which
 * needs `FILM_MANIFESTS.welcome` (S6's cuts, since release 2b; a build without them renders nothing and ends at once,
 * D1's dormant case). The reveal itself is LogoReveal "film-end", which WelcomeFilm mounts, not the overlay.
 */
export const WELCOME_FILM_OVERLAY: ComponentType<FilmOverlayProps> | null = WelcomeOverlay;
