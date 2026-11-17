import { Minus, Plus } from "lucide-react";
import { REST_STEP_SECONDS, formatCountdown } from "@/app/(dashboard)/workouts/active/_lib/session-progress";
import { SessionRing } from "./SessionRing";

type RestDockProps = {
  remaining: number;
  total: number;
  /** What follows the rest, e.g. "Set 3 of 4 · 10 reps · 60 kg". */
  upNext: string | null;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
};

/**
 * The rest countdown while resting: docked above the phone's exercise bar (bottom of the window from `sm`), so it
 * stays in reach wherever the page is scrolled. A role="timer" region: screen readers are not interrupted every
 * second; the page announces when the rest starts and ends.
 */
export function RestDock({ remaining, total, upNext, onAdjust, onSkip }: RestDockProps) {
  return (
    <section role="timer" aria-label="Rest timer" className="fitx-panel fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-40 mx-auto max-w-md border-fitx-primary/40 bg-fitx-elevated p-3 shadow-xl sm:bottom-4 sm:p-4">
      <div className="flex items-center gap-3">
        <SessionRing fraction={remaining / Math.max(1, total)} motion="tick" thickness={10} className="w-16">
          <span className="font-heading text-base font-extrabold tabular-nums text-fitx-text">{formatCountdown(remaining)}</span>
        </SessionRing>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fitx-text">Rest</p>
          {upNext ? <p className="mt-0.5 truncate text-xs text-fitx-text-secondary">Up next: {upNext}</p> : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" onClick={() => onAdjust(-REST_STEP_SECONDS)} aria-label={`${REST_STEP_SECONDS} seconds less rest`} className="fitx-button fitx-button-secondary min-h-11 gap-1 px-2 text-sm tabular-nums">
          <Minus size={14} aria-hidden="true" />{REST_STEP_SECONDS} s
        </button>
        <button type="button" onClick={() => onAdjust(REST_STEP_SECONDS)} aria-label={`${REST_STEP_SECONDS} seconds more rest`} className="fitx-button fitx-button-secondary min-h-11 gap-1 px-2 text-sm tabular-nums">
          <Plus size={14} aria-hidden="true" />{REST_STEP_SECONDS} s
        </button>
        <button type="button" onClick={onSkip} className="fitx-button min-h-11 whitespace-nowrap px-2 text-sm">Skip rest</button>
      </div>
    </section>
  );
}
