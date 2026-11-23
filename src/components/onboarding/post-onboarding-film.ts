import type { ComponentType } from "react";

/**
 * The cinematic film that plays once after onboarding, before the logo reveal (owner's phase 4, step 4).
 * Wave 1 has no film yet, so this is null and PostOnboardingSequence goes straight to the logo. Wave 2 sets it
 * to the new post-login film; that is the only change wave 2 makes here. The film calls `onEnd` once when it
 * finishes or is skipped.
 */
export const POST_ONBOARDING_FILM: ComponentType<{ onEnd: () => void }> | null = null;
