import { SlidersHorizontal, X } from "lucide-react";

export type ActiveFilterChip = { id: string; kind: string; label: string };

/**
 * The filters in force, as chips: each chip is one button that removes that filter, and "Clear all" removes them
 * all. Renders nothing when no filter is set. Chips wrap on narrow screens. A chip and Clear all go with their press:
 * the page moves focus on (see _lib/library-focus.ts; each chip is marked with its id for that).
 */
export function ActiveFilters({ chips, onRemove, onClearAll }: { chips: readonly ActiveFilterChip[]; onRemove: (id: string) => void; onClearAll: () => void }) {
  if (!chips.length) return null;
  return (
    <section aria-label="Active filters" className="flex flex-wrap items-center gap-2">
      <span className="inline-flex min-h-11 items-center gap-1.5 pr-1 text-xs font-semibold uppercase tracking-[.1em] text-fitx-text-secondary">
        <SlidersHorizontal size={14} aria-hidden="true" />Filtered
      </span>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {chips.map((chip) => (
          <li key={chip.id}>
            <button
              type="button"
              onClick={() => onRemove(chip.id)}
              aria-label={`Remove filter: ${chip.kind} ${chip.label}`}
              data-filter-chip={chip.id}
              className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-fitx-primary/40 bg-fitx-primary/10 py-1.5 pl-3.5 pr-2.5 text-left text-sm text-fitx-primary-text transition-colors hover:border-fitx-primary motion-reduce:transition-none"
            >
              <span className="text-xs text-fitx-text-secondary">{chip.kind}</span>
              <span className="min-w-0 truncate font-semibold">{chip.label}</span>
              <X size={15} aria-hidden="true" className="shrink-0" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClearAll} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-fitx-primary-text underline underline-offset-4">
        Clear all
      </button>
    </section>
  );
}
