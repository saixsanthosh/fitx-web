import type { ComponentType } from "react";
import { WelcomeFilm } from "@/components/brand/films/WelcomeFilm";

/**
 * The cinematic film that plays once after onboarding (owner's phase 4, step 4): the welcome film (BRIEF-2 3.3).
 * PostOnboardingSequence plays it only while its cuts exist (`FILM_MANIFESTS.welcome`, D1: dormant until then); it
 * ends on the logo itself and calls `onEnd` once when it finishes or is skipped.
 */
export const POST_ONBOARDING_FILM: ComponentType<{ onEnd: () => void; firstName?: string | null }> | null = WelcomeFilm;
