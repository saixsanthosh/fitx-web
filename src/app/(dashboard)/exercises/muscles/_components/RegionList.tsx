import { REGIONS, type RegionKey } from "@/lib/training/anatomy";

const GROUPS: ReadonlyArray<{ title: string; regions: readonly RegionKey[] }> = [
  { title: "Upper body", regions: ["neck", "traps", "shoulders", "chest"] },
  { title: "Arms", regions: ["biceps", "triceps", "forearms"] },
  { title: "Back", regions: ["lats", "middle_back", "lower_back"] },
  { title: "Core", regions: ["abdominals"] },
  { title: "Hips and legs", regions: ["glutes", "abductors", "adductors", "quadriceps", "hamstrings", "calves"] },
];

/** Every muscle of the body map as a button list: the same choice as the figure, for any screen size or input. */
export function RegionList({ selected, onSelect, sets }: { selected: RegionKey | null; onSelect: (region: RegionKey) => void; sets?: Partial<Record<RegionKey, number>> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      {GROUPS.map((group) => (
        <div key={group.title} role="group" aria-label={group.title} className="grid content-start gap-1.5">
          <p className="m-0 text-xs font-semibold uppercase tracking-[.1em] text-fitx-text-secondary">{group.title}</p>
          <div className="flex flex-wrap items-center gap-2">
            {group.regions.map((region) => {
              const on = region === selected;
              const count = sets?.[region] ?? 0;
              return (
                <button key={region} type="button" aria-pressed={on} onClick={() => onSelect(region)}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors motion-reduce:transition-none ${on ? "border-fitx-primary bg-fitx-primary/10 font-semibold text-fitx-primary-text" : "border-fitx-border bg-fitx-surface text-fitx-text hover:border-fitx-primary/45"}`}>
                  {REGIONS[region].label}
                  {count > 0 && <span className="text-xs font-normal text-fitx-text-secondary">{count} {count === 1 ? "set" : "sets"}<span className="sr-only"> this week</span></span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
