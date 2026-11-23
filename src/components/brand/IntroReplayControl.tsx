"use client";

import type { FilmId } from "./films/compositions";
import { REPLAY_EVENT } from "./introKeys";

const LABELS: Record<FilmId, string> = { intro: "Replay intro", welcome: "Replay welcome film" };

/** Replays a film over the page (CinematicIntro handles REPLAY_EVENT); `film` defaults to the intro. */
export function IntroReplayControl({ className = "fitx-intro-replay", film = "intro" }: { className?: string; film?: FilmId }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: { film } }))}
    >
      {LABELS[film]}
    </button>
  );
}
