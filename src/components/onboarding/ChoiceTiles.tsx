"use client";

import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { FieldError } from "@/components/profile/ProfileControls";

export type TileOption<V extends string | number> = { value: V; label: string; hint?: string; icon?: ReactNode; disabledHint?: string };

/**
 * One answer from a few, as large tiles with an icon: native radio inputs (one Tab stop, arrow keys move the
 * choice) inside a fieldset with a legend, so screen readers and the e2e `choose()` helper see a normal group.
 * `variant="number"` shows big numerals (meals a day, training days).
 */
export function ChoiceTiles<V extends string | number>({
  legend,
  hint,
  options,
  value,
  onChange,
  columns = "grid-cols-2 sm:grid-cols-3",
  error,
  disabledValues = [],
  variant = "tile",
}: {
  legend: ReactNode;
  hint?: ReactNode;
  options: readonly TileOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  columns?: string;
  error?: string | null;
  disabledValues?: readonly V[];
  variant?: "tile" | "row" | "number" | "compact";
}) {
  const name = useId();
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset aria-describedby={describedBy} aria-invalid={error ? true : undefined} className="min-w-0">
      <legend className="text-sm font-semibold text-fitx-text">{legend}</legend>
      {hint && <p id={hintId} className="mt-1 text-xs leading-5 text-fitx-text-secondary">{hint}</p>}
      <div className={`mt-3 grid gap-2 ${columns}`}>
        {options.map((option) => {
          const disabled = disabledValues.includes(option.value);
          const layout =
            variant === "number" ? "min-h-16 flex-col justify-center text-center"
            : variant === "compact" ? "min-h-12 items-center justify-center px-2 py-2 text-center"
            : variant === "row" ? "min-h-14 items-center gap-3 py-2 pl-3 pr-8 text-left sm:pl-3.5"
            : "min-h-[6.5rem] flex-col items-start gap-3 p-3 text-left sm:p-3.5";
          // Small tiles show the choice by their border and fill; the others also get a tick in the corner.
          const tick = variant === "tile" || variant === "row";
          return (
            <label
              key={String(option.value)}
              className={`group relative flex cursor-pointer select-none rounded-2xl border border-fitx-border bg-fitx-surface transition-[border-color,background-color,transform] duration-200 hover:border-fitx-text-disabled motion-safe:active:scale-[.985] has-checked:border-fitx-primary has-checked:bg-fitx-primary/[.07] has-disabled:cursor-not-allowed has-disabled:opacity-55 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fitx-primary ${layout}`}
            >
              <input type="radio" name={name} value={String(option.value)} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} className="sr-only" />
              {option.icon && (
                <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-xl bg-fitx-surface-variant text-fitx-text-secondary transition-colors group-has-checked:bg-fitx-primary group-has-checked:text-fitx-on-primary ${variant === "row" ? "h-9 w-9" : "h-10 w-10"}`}>
                  {option.icon}
                </span>
              )}
              {/* In a tile the words sit at the bottom, clear of the tick in the top corner. */}
              <span className={`min-w-0 ${variant === "tile" ? "mt-auto pr-1" : ""}`}>
                <span className={`block hyphens-auto text-fitx-text ${variant === "number" ? "text-2xl font-semibold tracking-[-.03em] tabular-nums group-has-checked:text-fitx-primary-text" : "text-[.8125rem] font-semibold leading-tight sm:text-sm"}`}>{option.label}</span>
                {option.hint && variant !== "number" && <span className="mt-1 block text-xs leading-[1.35] text-fitx-text-secondary">{option.hint}</span>}
                {disabled && option.disabledHint && <span className="mt-1 block text-xs leading-[1.35] text-fitx-text-secondary">{option.disabledHint}</span>}
              </span>
              {tick && (
                <span aria-hidden="true" className="absolute right-2.5 top-2.5 grid h-5 w-5 scale-75 place-items-center rounded-full bg-fitx-primary text-fitx-on-primary opacity-0 transition-[opacity,transform] duration-200 group-has-checked:scale-100 group-has-checked:opacity-100">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </label>
          );
        })}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}
