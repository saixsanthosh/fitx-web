"use client";

import { useId } from "react";
import { History, Search, X } from "lucide-react";

/**
 * The library's search box with the member's recent searches (kept on this device) under it while it is empty.
 * Enter keeps the search in the recent list; each recent search can be reused or forgotten. The ×, a recent search
 * and Clear recent go with their press: the page moves focus on (see _lib/library-focus.ts), never into the box.
 */
export function SearchField({ value, onChange, onClear, onSubmit, recent, onPickRecent, onForgetRecent, onClearRecent }: {
  value: string;
  onChange: (value: string) => void;
  /** The × ("Clear the search"): empties the box (typing it empty is onChange). */
  onClear: () => void;
  onSubmit: () => void;
  recent: readonly string[];
  onPickRecent: (term: string) => void;
  onForgetRecent: (term: string) => void;
  onClearRecent: () => void;
}) {
  const inputId = useId();
  const recentId = useId();
  const showRecent = !value.trim() && recent.length > 0;
  return (
    <div className="grid min-w-0 flex-1 gap-2">
      <form role="search" aria-label="Exercises" className="relative" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <label htmlFor={inputId} className="sr-only">Search exercises</label>
        <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fitx-text-disabled" />
        <input
          id={inputId}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search, e.g. bench press"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={showRecent ? recentId : undefined}
          className="fitx-field pl-11 pr-12 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value && (
          <button type="button" aria-label="Clear the search" onClick={onClear}
            className="absolute right-0.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-md text-fitx-text-secondary hover:text-fitx-text">
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </form>
      {showRecent && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span id={recentId} className="inline-flex items-center gap-1.5 text-xs text-fitx-text-secondary"><History size={13} aria-hidden="true" />Recent searches on this device</span>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {recent.map((term) => (
              <li key={term} className="inline-flex items-center rounded-full border border-fitx-border bg-fitx-surface">
                <button type="button" onClick={() => onPickRecent(term)} className="inline-flex min-h-11 items-center pl-3.5 pr-1 text-sm text-fitx-text hover:text-fitx-primary-text">{term}</button>
                <button type="button" onClick={() => onForgetRecent(term)} aria-label={`Remove “${term}” from recent searches`} data-recent-forget={term} className="grid h-11 w-9 place-items-center rounded-full text-fitx-text-secondary hover:text-fitx-text">
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onClearRecent} className="inline-flex min-h-11 items-center px-1 text-xs font-semibold text-fitx-primary-text underline underline-offset-4">Clear recent</button>
        </div>
      )}
    </div>
  );
}
