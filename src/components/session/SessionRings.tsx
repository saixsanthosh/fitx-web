import type { ReactNode } from "react";
import { formatCountdown } from "@/app/(dashboard)/workouts/active/_lib/session-progress";
import { SessionRing } from "./SessionRing";

type SessionRingsProps = {
  /** The current set's target: its reps, or the movement's seconds; null when none was set. */
  target: { kind: "reps"; value: number } | { kind: "seconds"; value: number } | null;
  /** A timed set's countdown while it runs. */
  setTimer: { remaining: number; total: number } | null;
  /** The rest countdown while resting (or held while paused). */
  rest: { remaining: number; total: number; held: boolean } | null;
  /** The exercise's planned rest, shown while not resting. */
  plannedRestSeconds: number;
  setsDone: number;
  setsTotal: number;
};

/**
 * The three indicators of the current exercise: the current set's target (a timed set's countdown fills the ring),
 * the rest timer, and the sets made. Every value is measured or set by the plan; a ring with nothing to measure
 * shows its track only. Hidden from assistive technology: the same values are written out beside it (the set
 * headline, the target line and the rest timer).
 */
export function SessionRings({ target, setTimer, rest, plannedRestSeconds, setsDone, setsTotal }: SessionRingsProps) {
  const timing = target?.kind === "seconds" && setTimer;
  const targetRing = (
    <SessionRing fraction={timing ? (setTimer.total - setTimer.remaining) / Math.max(1, setTimer.total) : null} motion="tick" className="w-full">
      {target === null
        ? <Value value="—" unit="" />
        : timing
          ? <Value value={formatCountdown(setTimer.remaining)} unit="left" />
          : target.kind === "seconds"
            ? (target.value < 120 ? <Value value={String(target.value)} unit="sec" /> : <Value value={formatCountdown(target.value)} unit="min" />)
            : <Value value={String(target.value)} unit={target.value === 1 ? "rep" : "reps"} />}
    </SessionRing>
  );
  const restRing = (
    <SessionRing fraction={rest ? rest.remaining / Math.max(1, rest.total) : null} motion="tick" className="w-full">
      {rest
        ? <Value value={formatCountdown(rest.remaining)} unit={rest.held ? "held" : "left"} />
        : plannedRestSeconds < 120 ? <Value value={String(Math.max(0, Math.round(plannedRestSeconds)))} unit="sec" /> : <Value value={formatCountdown(plannedRestSeconds)} unit="min" />}
    </SessionRing>
  );
  const setsRing = (
    <SessionRing fraction={setsTotal ? setsDone / setsTotal : null} className="w-full">
      <Value value={`${setsDone}/${setsTotal}`} unit="sets" />
    </SessionRing>
  );
  return (
    <div aria-hidden="true" className="grid grid-cols-3 gap-3 sm:gap-5">
      <Indicator label={target === null ? "No target set" : timing ? "Set timer" : target.kind === "seconds" ? "Time target" : "Reps target"}>{targetRing}</Indicator>
      <Indicator label={rest ? (rest.held ? "Rest held" : "Rest") : "Rest"} active={Boolean(rest && !rest.held)}>{restRing}</Indicator>
      <Indicator label="Sets made">{setsRing}</Indicator>
    </div>
  );
}

function Indicator({ label, active = false, children }: { label: string; active?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <div className="w-full max-w-[104px]">{children}</div>
      <span className={`text-center text-xs font-semibold ${active ? "text-fitx-primary-text" : "text-fitx-text-secondary"}`}>{label}</span>
    </div>
  );
}

function Value({ value, unit }: { value: string; unit: string }) {
  return (
    <>
      <span className="font-heading text-xl font-extrabold leading-none tabular-nums text-fitx-text sm:text-2xl">{value}</span>
      {unit ? <span className="mt-1 text-[11px] font-medium leading-none text-fitx-text-secondary">{unit}</span> : null}
    </>
  );
}
