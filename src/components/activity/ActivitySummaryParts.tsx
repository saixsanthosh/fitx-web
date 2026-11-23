import Link from "next/link";
import { Info } from "lucide-react";
import { kcalMethodFor } from "@/lib/activity/calories";
import { usesPace } from "@/lib/activity/config";
import { formatDistance, formatDuration, formatPace, formatSpeed, kmValue, paceValue, speedValue } from "@/lib/activity/format";
import type { ActivityView } from "@/lib/activity/repository";
import { kcalFromDevice, sourceSentence } from "@/lib/activity/source";
import { GAP_LABEL, MAP_TILES_NOTE } from "./messages";

/*
 * The parts of an activity's result shared by its page and by the Record screen's own result
 * (shown when finishing without a connection): statistics, splits, interruptions and the notes
 * on how each number was made.
 */

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-fitx-border bg-fitx-surface p-3 sm:p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-fitx-text sm:text-2xl">{value}</p>
      {note && <p className="mt-1 text-[11px] leading-4 text-fitx-text-secondary">{note}</p>}
    </div>
  );
}

export function ActivityStatsPanel({ view, kcal, showWeightLink = true }: { view: ActivityView; kcal: number | null; showWeightLink?: boolean }) {
  const pace = usesPace(view.sport);
  const imported = view.source === "file";
  const deviceKcal = kcalFromDevice({ source: view.source, kcalMethod: view.kcalMethod });
  return (
    <section aria-label="Activity statistics" className="space-y-3">
      <div className="fitx-panel p-4 sm:p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Distance</p>
        <p className="mt-1 text-[52px] font-semibold leading-none tabular-nums tracking-tight text-fitx-text">{kmValue(view.distanceM)}<span className="ml-1.5 text-xl font-medium text-fitx-text-secondary">km</span></p>
        {imported && <p className="mt-2 text-[11px] leading-4 text-fitx-text-secondary">Worked out by FITX from the file’s GPS points.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Moving time" value={formatDuration(view.movingSeconds)} />
        <Metric label="Elapsed time" value={formatDuration(view.elapsedSeconds)} note={view.pausedSeconds > 0 ? `${formatDuration(view.pausedSeconds)} paused` : undefined} />
        {pace && <Metric label="Avg pace" value={paceValue(view.avgPaceSecondsPerKm)} note="per km, moving time" />}
        <Metric label="Avg speed" value={speedValue(view.avgSpeedMps)} note="km/h, moving time" />
        {!pace && <Metric label="Max speed" value={speedValue(view.maxSpeedMps)} note={view.maxSpeedMps !== null ? "km/h" : imported ? "the file has no speed readings" : "your phone didn’t report its speed"} />}
        <Metric label="Calories" value={kcal === null ? "–" : `≈ ${kcal}`} note={kcal === null ? "Add your weight in Profile to see an estimate" : deviceKcal ? "kcal, estimated by your device" : "kcal, estimated"} />
        {view.elevationGainM !== null && <Metric label="Climb" value={`${Math.round(view.elevationGainM)} m`} note={imported ? "from the file’s altitude, approximate" : "from GPS altitude, approximate"} />}
      </div>
      {kcal === null && showWeightLink && <Link href="/profile" className="inline-flex min-h-11 items-center text-sm font-medium text-fitx-primary-text">Add your weight</Link>}
    </section>
  );
}

export function SplitsTable({ view }: { view: ActivityView }) {
  if (!view.splits.length) return null;
  const pace = usesPace(view.sport);
  return (
    <section className="fitx-panel overflow-hidden" aria-labelledby="splits-title">
      <h2 id="splits-title" className="border-b border-fitx-divider px-4 py-3 text-sm font-semibold text-fitx-text sm:px-5">Splits</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] uppercase tracking-[.12em] text-fitx-text-secondary">
          <tr><th scope="col" className="px-4 py-2 font-semibold sm:px-5">Km</th><th scope="col" className="px-2 py-2 font-semibold">{pace ? "Pace" : "Speed"}</th><th scope="col" className="px-2 py-2 font-semibold">Moving</th><th scope="col" className="px-4 py-2 text-right font-semibold sm:px-5">Elapsed</th></tr>
        </thead>
        <tbody>
          {view.splits.map((split) => {
            const speed = split.movingSeconds > 0 ? split.distanceM / split.movingSeconds : null;
            return (
              <tr key={split.index} className="border-t border-fitx-divider tabular-nums">
                <td className="px-4 py-2.5 sm:px-5">{split.distanceM < 1000 ? `${split.index} (${formatDistance(split.distanceM)})` : split.index}</td>
                <td className="px-2 py-2.5 font-medium">{pace ? formatPace(speed ? 1000 / speed : null) : formatSpeed(speed)}</td>
                <td className="px-2 py-2.5 text-fitx-text-secondary">{formatDuration(split.movingSeconds)}</td>
                <td className="px-4 py-2.5 text-right text-fitx-text-secondary sm:px-5">{formatDuration(split.elapsedSeconds)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function InterruptionsList({ view }: { view: ActivityView }) {
  if (!view.gaps.length) return null;
  return (
    <section className="fitx-panel p-4 sm:p-5" aria-labelledby="gaps-title">
      <h2 id="gaps-title" className="flex items-center gap-2 text-sm font-semibold text-fitx-text"><Info size={16} aria-hidden="true" className="text-fitx-info" />Interruptions</h2>
      <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">
        {view.source === "file"
          ? "Stretches of the file without GPS points, and positions that jumped, add no distance or moving time. FITX doesn’t guess them."
          : "Phones stop sharing location with websites while the screen is locked or another app is open, GPS can drop out, and a position can jump. FITX doesn’t guess these stretches: they add no distance or moving time."}
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {view.gaps.map((gap) => (
          <li key={gap.start} className="flex flex-wrap justify-between gap-2 rounded-lg bg-fitx-surface-variant px-3 py-2">
            <span>{GAP_LABEL[gap.kind]}</span>
            <span className="tabular-nums text-fitx-text-secondary">{formatDuration((gap.end - gap.start) / 1000)}{gap.straightLineM !== null && gap.straightLineM >= 20 ? ` · ${formatDistance(gap.straightLineM)} apart` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AboutNumbers({ view, kcal, kcalWeight }: { view: ActivityView; kcal: number | null; kcalWeight: number | null }) {
  return (
    <section className="fitx-panel space-y-3 p-4 text-xs leading-5 text-fitx-text-secondary sm:p-5" aria-label="About these numbers">
      <p><span className="font-semibold text-fitx-text">Source:</span> {sourceSentence(view)}</p>
      {kcal !== null && <p><span className="font-semibold text-fitx-text">Calories</span> are an estimate: {view.kcalMethod ?? kcalMethodFor(view.sport)}{kcalWeight ? ` Weight used: ${kcalWeight} kg.` : ""}</p>}
      <p><span className="font-semibold text-fitx-text">Moving time</span> leaves out pauses, stops and interruptions; <span className="font-semibold text-fitx-text">elapsed time</span> is start to finish.</p>
      <p><span className="font-semibold text-fitx-text">Privacy:</span> your routes are visible only to you. Share images leave out the area around the start and finish. Detailed GPS points are kept for 90 days; this summary and route stay until you delete them. {MAP_TILES_NOTE}</p>
    </section>
  );
}
