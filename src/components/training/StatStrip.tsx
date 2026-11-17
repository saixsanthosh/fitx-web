import type { ReactNode } from "react";

export type Stat = {
  label: string;
  /** The value as text. Use null for an unknown value: it shows "—" and is never counted as 0. */
  value: string | number | null;
  unit?: string;
  /** Mark the number as an estimate ("≈ estimate", with the strip's footnote). */
  estimate?: boolean;
  /** One short line under the value, e.g. "pauses excluded". */
  note?: ReactNode;
};

type StatStripProps = {
  stats: readonly Stat[];
  /** The accessible name of the group. */
  label?: string;
  /** Shown under the strip when any stat is an estimate. */
  estimateNote?: string;
  className?: string;
};

const COLUMNS: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3" };

/**
 * Large, readable numbers: label, value, unit. Two columns on phones, up to four on wide screens.
 * An estimate carries "≈ estimate" and the strip prints one footnote that says what that means.
 */
export function StatStrip({ stats, label = "Summary", estimateNote = "≈ estimate: worked out from what you logged, not measured directly.", className = "" }: StatStripProps) {
  if (!stats.length) return null;
  const anyEstimate = stats.some((stat) => stat.estimate);
  return (
    <div className={className}>
      <dl aria-label={label} className={`m-0 grid grid-cols-2 gap-2 sm:gap-3 ${COLUMNS[stats.length] ?? "lg:grid-cols-4"}`}>
        {stats.map((stat) => {
          const unknown = stat.value === null || stat.value === "";
          return (
            <div key={stat.label} className="min-w-0 rounded-xl border border-fitx-border bg-fitx-card px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-[.08em] text-fitx-text-secondary">{stat.label}</dt>
              <dd className="m-0 mt-1">
                <span className="font-heading text-2xl font-extrabold leading-tight tabular-nums text-fitx-text sm:text-3xl">
                  {stat.estimate && !unknown ? <span aria-hidden="true" className="mr-0.5 text-fitx-text-secondary">≈</span> : null}
                  {unknown ? <><span aria-hidden="true">—</span><span className="sr-only">Not available</span></> : stat.value}
                </span>
                {stat.unit && !unknown ? <span className="ml-1 text-sm font-semibold text-fitx-text-secondary">{stat.unit}</span> : null}
                {stat.estimate && !unknown ? <span className="ml-2 inline-block rounded-full bg-fitx-surface-variant px-2 py-0.5 align-middle text-[11px] font-semibold text-fitx-text-secondary">estimate<span className="sr-only"> (see note below)</span></span> : null}
                {stat.note ? <span className="mt-1 block text-xs text-fitx-text-secondary">{stat.note}</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>
      {anyEstimate ? <p className="mb-0 mt-2 text-xs text-fitx-text-secondary">{estimateNote}</p> : null}
    </div>
  );
}
