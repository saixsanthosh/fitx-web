/** The logo reveal's variants and timing (LogoReveal.tsx and LogoReveal.module.css follow these numbers). */
export type LogoRevealVariant = "welcome" | "return" | "film-end";

/** The whole reveal, exit included, in ms. The owner's limit is 2.2 s. */
export const REVEAL_TOTAL_MS = 2100;
/** How long the still logo shows with reduced motion. */
export const REVEAL_REDUCED_MS = 400;
/** A reveal is never longer than this, whatever the variant. */
export const REVEAL_MAX_MS = 2200;

export type RevealPlan = {
  /** The CSS module class for the variant. */
  className: "welcome" | "return" | "filmEnd";
  /** The FITX wordmark rises under the mark. */
  wordmark: boolean;
  /** It fades out at the end (false: it holds on the logo, for the film's last frame). */
  exits: boolean;
  /** When the last animation ends, in ms. */
  totalMs: number;
};

/**
 * - welcome: after onboarding, on the page's own background, with the wordmark, then fades out.
 * - return: a returning member signing in again, the same moment, slightly brisker at the end.
 * - film-end: over a film's last frame (transparent stage), holding on the logo.
 */
export function revealPlan(variant: LogoRevealVariant): RevealPlan {
  if (variant === "film-end") return { className: "filmEnd", wordmark: true, exits: false, totalMs: 1800 };
  if (variant === "return") return { className: "return", wordmark: true, exits: true, totalMs: 2000 };
  return { className: "welcome", wordmark: true, exits: true, totalMs: REVEAL_TOTAL_MS };
}
