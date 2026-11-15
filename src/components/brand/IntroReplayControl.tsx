"use client";

export function IntroReplayControl() {
  return (
    <button
      type="button"
      className="fitx-intro-replay"
      onClick={() => window.dispatchEvent(new Event("fitx:intro:replay"))}
    >
      Replay intro
    </button>
  );
}
