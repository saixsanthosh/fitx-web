"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean };

type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  /** Stretch the segments to the full width. */
  block?: boolean;
  className?: string;
};

/**
 * A segmented control built on native radio buttons: one Tab stop, arrow keys move the choice, and each
 * segment is at least 44 px tall.
 */
export function Segmented<T extends string>({ options, value, onChange, label, block = false, className }: SegmentedProps<T>) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex gap-1 rounded-[14px] border border-fitx-border bg-fitx-surface-variant p-1", block && "flex w-full", className)}>
      {options.map((option) => (
        <label key={option.value} className={cn("relative min-w-0", block && "flex-1", option.disabled ? "cursor-not-allowed" : "cursor-pointer")}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
            className="peer sr-only"
          />
          <span className="flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium text-fitx-text-secondary transition-[background-color,color,box-shadow] duration-200 hover:text-fitx-text peer-checked:bg-fitx-surface peer-checked:text-fitx-text peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fitx-primary peer-disabled:opacity-50">
            {option.icon}
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}
