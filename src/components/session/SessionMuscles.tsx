import { BodyMap } from "@/components/anatomy/BodyMap";
import type { RegionKey } from "@/lib/training/anatomy";
import type { MuscleSummary } from "@/lib/training/muscle-history";

type SessionMusclesProps = {
  /** The session's muscles (muscle-history.ts summariseMuscles); null while they load. */
  summary: MuscleSummary | null;
  /** False when the muscles could not be read (the stats and sets still show). */
  failed?: boolean;
  /** Regions listed under the map; the rest stay on the map only. */
  listLimit?: number;
};

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * The muscles one session trained, on the FITX body map (front and back) with the same numbers as text: direct sets
 * (the exercise's main muscle) and assisting sets, and each muscle's share of the session's load. Only completed
 * sets of a completed session count (contract C3); exercises with no muscles in the library are reported, never
 * guessed.
 */
export function SessionMuscles({ summary, failed = false, listLimit = 6 }: SessionMusclesProps) {
  if (failed) {
    return <p className="m-0 rounded-xl border border-dashed border-fitx-border px-4 py-4 text-sm text-fitx-text-secondary">The muscles this session trained couldn’t be loaded. Your sets and totals are saved.</p>;
  }
  if (!summary) {
    return <div role="status" className="h-56 animate-pulse rounded-xl bg-fitx-surface-variant"><span className="sr-only">Working out the muscles this session trained</span></div>;
  }
  const levels = Object.fromEntries(summary.ranked.map((region) => [region.region, region.level])) as Partial<Record<RegionKey, number>>;
  const unmapped = summary.unmapped.exercises.length;
  const unmappedNote = unmapped ? `${plural(unmapped, "exercise isn’t", "exercises aren’t")} linked to a muscle in the exercise library, so ${unmapped === 1 ? "it isn’t" : "they aren’t"} shown.` : null;
  if (!summary.ranked.length) {
    return (
      <div className="rounded-xl border border-dashed border-fitx-border px-4 py-5 text-center">
        <p className="m-0 text-sm font-medium text-fitx-text">No muscles to show</p>
        <p className="m-0 mx-auto mt-1 max-w-md text-sm text-fitx-text-secondary">{unmappedNote ?? "No completed set in this session is linked to an exercise with listed muscles."}</p>
      </div>
    );
  }
  const shown = summary.ranked.slice(0, listLimit);
  return (
    <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <BodyMap title="Muscles trained in this session" levels={levels} legend size="md" className="mx-auto" />
      <div className="min-w-0">
        <ul className="m-0 list-none space-y-2.5 p-0">
          {shown.map((region) => (
            <li key={region.region} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-fitx-text">{region.label}</span>
                <span className="text-xs font-semibold tabular-nums text-fitx-text-secondary">{Math.round(region.share)}%</span>
              </div>
              <div className="fitx-progress-track mt-1 h-1.5" aria-hidden="true"><div className="fitx-progress-fill motion-reduce:transition-none" style={{ width: `${Math.max(4, Math.round(region.level * 100))}%` }} /></div>
              <p className="m-0 mt-1 text-xs text-fitx-text-secondary">
                {[region.primarySets ? plural(region.primarySets, "direct set", "direct sets") : null, region.secondarySets ? `${region.secondarySets.toLocaleString()} assisting` : null].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
        {summary.ranked.length > shown.length ? <p className="m-0 mt-2 text-xs text-fitx-text-secondary">And {plural(summary.ranked.length - shown.length, "more muscle", "more muscles")} on the map.</p> : null}
        <p className="m-0 mt-3 text-xs leading-5 text-fitx-text-secondary">From each exercise’s listed muscles: a completed set counts in full for its main muscle and half for each assisting one. Each share is of the whole session.</p>
        {unmappedNote ? <p className="m-0 mt-1 text-xs leading-5 text-fitx-text-secondary">{unmappedNote}</p> : null}
      </div>
    </div>
  );
}
