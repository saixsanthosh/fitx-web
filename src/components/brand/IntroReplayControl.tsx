"use client";

export function IntroReplayControl({ className = "fitx-intro-replay" }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event("fitx:intro:replay"))}
    >
      Replay intro
    </button>
  );
}
