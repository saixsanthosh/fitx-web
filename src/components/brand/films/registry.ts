import type { ComponentType } from "react";
import type { FilmOverlayProps } from "./compositions";
import { WelcomeOverlay } from "./welcome/WelcomeOverlay";

/**
 * The welcome film's DOM overlay ("Welcome, <first name>"), drawn over the video by FilmVideo: film-welcome's
 * `WelcomeOverlay`, set by the integrator (BRIEF-2 6.1b). Only WelcomeFilm reads it, and only in its film case, so it
 * changes nothing while `FILM_MANIFESTS.welcome` is null (D1 dormant: WelcomeFilm then renders nothing and ends at
 * once). The reveal itself is LogoReveal "film-end", which WelcomeFilm mounts, not the overlay.
 */
export const WELCOME_FILM_OVERLAY: ComponentType<FilmOverlayProps> | null = WelcomeOverlay;
