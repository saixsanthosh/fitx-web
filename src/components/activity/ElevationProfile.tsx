import { profilePaths, type ElevationProfile as Profile } from "@/lib/activity/elevation";
import { formatDistance } from "@/lib/activity/format";
import type { ActivitySource } from "@/lib/activity/types";

const WIDTH = 600;
const HEIGHT = 140;

/**
 * Altitude against distance for one activity. Stretches stay separate (gaps are never joined).
 * The figure has a text alternative with the same numbers.
 */
export function ElevationProfile({ profile, source, climbM }: { profile: Profile; source: ActivitySource; climbM: number | null }) {
  const { lines, areas } = profilePaths(profile, WIDTH, HEIGHT);
  const low = Math.round(profile.minAlt);
  const high = Math.round(profile.maxAlt);
  const summary = `Elevation profile: lowest ${low} m, highest ${high} m, over ${formatDistance(profile.distanceM)}${climbM !== null ? `, ${Math.round(climbM)} m of climb` : ""}.`;
  return (
    <section className="fitx-panel p-4 sm:p-5" aria-labelledby="elevation-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="elevation-title" className="text-sm font-semibold text-fitx-text">Elevation</h2>
        <p className="text-xs text-fitx-text-secondary">{source === "file" ? "From the file’s altitude readings, approximate" : "From GPS altitude, approximate"}</p>
      </div>
      <figure className="mt-3">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="h-28 w-full sm:h-32" role="img" aria-label={summary}>
          <line x1="0" y1={HEIGHT - 0.5} x2={WIDTH} y2={HEIGHT - 0.5} stroke="var(--fitx-divider)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {areas.map((d, i) => <path key={`a${i}`} d={d} fill="var(--fitx-primary)" fillOpacity={0.12} />)}
          {lines.map((d, i) => <path key={`l${i}`} d={d} fill="none" stroke="var(--fitx-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
        </svg>
        <figcaption className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs tabular-nums text-fitx-text-secondary">
          <span>Lowest {low} m</span>
          <span>Highest {high} m</span>
          <span>{formatDistance(profile.distanceM)}</span>
        </figcaption>
      </figure>
    </section>
  );
}
