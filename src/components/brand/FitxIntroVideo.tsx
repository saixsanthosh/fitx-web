"use client";

import { FilmVideo } from "./films/FilmVideo";
import type { Theme } from "./intro/types";

type Props = {
  theme: Theme;
  onStage: (stage: number) => void;
  onReady: () => void;
  onComplete: () => void;
  onUnsupported: () => void;
  /** Playback stalled (buffering) or resumed: the overlay pauses its CSS clocks to stay in sync. */
  onHold: (holding: boolean) => void;
  /** The playing `<video>`, for the film's sound (optional). */
  onVideo?: (video: HTMLVideoElement | null) => void;
};

/**
 * The FITX intro film as video: the generic FilmVideo on the intro's manifest (BRIEF-2 3.1), with the props it had
 * in wave 1. The opening-frame poster (CinematicIntro) shows until the first frame plays over it.
 */
export function FitxIntroVideo({ theme, onStage, onReady, onComplete, onUnsupported, onHold, onVideo }: Props) {
  return (
    <FilmVideo
      film="intro"
      theme={theme}
      onStage={onStage}
      onReady={onReady}
      onEnd={onComplete}
      onUnsupported={onUnsupported}
      onHold={onHold}
      onVideo={onVideo}
    />
  );
}
