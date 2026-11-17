import { SearchX } from "lucide-react";

export type RelaxOption = { id: string; label: string; count: number };

/**
 * An empty result that says why and how to get results: a spelling suggestion, and the single changes that would
 * show exercises again ("Remove Barbell: 14 exercises"), most results first.
 */
export function NoResults({ title, description, spelling, options, onSpelling, onRelax, clearLabel, onClear }: {
  title: string;
  description: string;
  spelling?: string | null;
  options: readonly RelaxOption[];
  onSpelling?: (text: string) => void;
  onRelax: (id: string) => void;
  clearLabel?: string;
  onClear?: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-fitx-border bg-fitx-surface/60 px-4 py-7 text-center sm:px-6">
      <SearchX size={22} aria-hidden="true" className="mx-auto text-fitx-text-secondary" />
      <h3 className="m-0 mt-2 text-base font-semibold text-fitx-text">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-fitx-text-secondary">{description}</p>
      {spelling && onSpelling && (
        <p className="m-0 mt-3 text-sm text-fitx-text">
          Did you mean{" "}
          <button type="button" onClick={() => onSpelling(spelling)} className="inline-flex min-h-11 items-center font-semibold text-fitx-primary-text underline underline-offset-4">“{spelling}”</button>?
        </p>
      )}
      {options.length > 0 && (
        <div className="mt-4">
          <p className="m-0 text-xs font-semibold uppercase tracking-[.1em] text-fitx-text-secondary">Try one change</p>
          <ul className="m-0 mt-2 flex list-none flex-wrap justify-center gap-2 p-0">
            {options.map((option) => (
              <li key={option.id}>
                <button type="button" onClick={() => onRelax(option.id)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-fitx-border bg-fitx-surface px-4 text-sm font-medium text-fitx-text transition-colors hover:border-fitx-primary/45 motion-reduce:transition-none">
                  {option.label}
                  <span className="text-xs text-fitx-text-secondary">{option.count.toLocaleString()} {option.count === 1 ? "exercise" : "exercises"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {onClear && clearLabel && (
        <button type="button" onClick={onClear} className="fitx-button fitx-button-secondary mt-5 min-h-11">{clearLabel}</button>
      )}
    </div>
  );
}
