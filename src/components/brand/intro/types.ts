/**
 * Shared contracts for the FITX cinematic intro.
 *
 * Everything under `intro/` builds against these types. Modules that run inside the
 * character-generation worker (`sdf/`, `rig/skeleton.ts`, `character/*` except
 * `assemble.ts`/`materials.ts`/`faceRig.ts`/`client.ts`) must stay free of `three` and DOM APIs.
 */

export type Theme = "light" | "dark";

/** Render quality chosen once at start-up (and possibly downgraded once by the frame-time guard). */
export type QualityTier = "high" | "medium";

/** Callbacks the React wrapper passes to the director. Same semantics as the original scene props. */
export type IntroCallbacks = {
  /** Called whenever the film enters a new stage (see `timeline.ts`). */
  onStage: (stage: number) => void;
  /** Called once, when the first shot has rendered with its subject on screen. */
  onReady: () => void;
  /** Called once, when the film (including the brand hold) has finished. */
  onComplete: () => void;
  /** Called once if WebGL/worker/performance makes the film impossible; the overlay shows the static brand. */
  onUnsupported: () => void;
};

export type Vec3Tuple = [number, number, number];

/** Linear-space RGB, each channel 0..1. Converted from sRGB hex with `srgbHexToLinear` in `math.ts`. */
export type LinearRGB = [number, number, number];
