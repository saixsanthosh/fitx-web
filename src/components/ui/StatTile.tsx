import type { ReactNode } from "react";
import { CountUp } from "@/components/motion/CountUp";
import { isKnown } from "@/components/motion/count-format";
import { cn } from "@/lib/utils";

type StatTileProps = {
  label: ReactNode;
  /** null means nothing logged: an en dash and "Not logged", never 0. */
  value: number | null;
  /** Always give the unit: kcal, g, km, min. */
  unit?: string;
  /** The value is calculated, not measured: adds "≈" and an "Estimate" label. */
  estimate?: boolean;
  /** One short line under the value. */
  hint?: ReactNode;
  format?: (value: number) => string;
  className?: string;
};

/** One figure with its label and unit. Counts up when it first appears. */
export function StatTile({ label, value, unit, estimate = false, hint, format, className }: StatTileProps) {
  const known = isKnown(value);
  return (
    <div className={cn("min-w-0 rounded-2xl border border-fitx-border bg-fitx-card p-4 sm:p-5", className)}>
      <p className="flex items-center justify-between gap-2 text-xs font-medium text-fitx-text-secondary">
        <span className="truncate">{label}</span>
        {estimate && known && <span className="shrink-0 rounded-full bg-fitx-surface-variant px-2 py-0.5 text-[11px] text-fitx-text-secondary">Estimate</span>}
      </p>
      <p className="mt-2 flex items-baseline gap-1 font-heading text-[28px] font-bold leading-none tracking-[-.03em] text-fitx-text">
        {estimate && known && <span aria-hidden="true" className="text-fitx-text-secondary">≈</span>}
        {estimate && known && <span className="sr-only">About</span>}
        <CountUp value={value} format={format} />
        {unit && known && <span className="ml-0.5 font-body text-sm font-medium tracking-normal text-fitx-text-secondary">{unit}</span>}
      </p>
      {!known ? <p className="mt-2 text-xs text-fitx-text-secondary">Not logged</p> : hint ? <p className="mt-2 truncate text-xs text-fitx-text-secondary">{hint}</p> : null}
    </div>
  );
}

/** A row of StatTiles: two columns on phones, up to four from tablets. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]", className)}>{children}</div>;
}
