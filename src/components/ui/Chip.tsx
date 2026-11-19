"use client";

import { createContext, useContext, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { nextChipIndex } from "./chip-keys";

const ChipMode = createContext<"single" | "multiple" | null>(null);

type ChipProps = {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
};

/**
 * A pill button. In a single-choice ChipGroup it is a radio (aria-checked); otherwise a toggle
 * (aria-pressed) when `selected` is given, or a plain button.
 */
export function Chip({ children, selected, onClick, disabled, icon, className }: ChipProps) {
  const mode = useContext(ChipMode);
  const state = mode === "single"
    ? { role: "radio" as const, "aria-checked": Boolean(selected) }
    : selected === undefined ? {} : { "aria-pressed": selected };
  return (
    <button
      type="button"
      data-fitx-chip=""
      disabled={disabled}
      onClick={onClick}
      {...state}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors duration-150 disabled:opacity-50",
        selected
          ? "border-fitx-text bg-fitx-text text-fitx-bg"
          : "border-fitx-border bg-fitx-surface text-fitx-text-secondary hover:border-fitx-text-disabled hover:text-fitx-text",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * A wrapping row of Chips with one accessible name. Arrow keys, Home and End move between chips.
 * `multiple` (toggles) is a group; without it the chips behave as one radio group.
 */
export function ChipGroup({ children, multiple = false, label, className }: { children: ReactNode; multiple?: boolean; label: string; className?: string }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const chips = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-fitx-chip]:not(:disabled)")];
    const current = chips.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextChipIndex(event.key, current, chips.length);
    if (next === null) return;
    event.preventDefault();
    chips[next]?.focus();
  }
  return (
    <ChipMode.Provider value={multiple ? "multiple" : "single"}>
      <div role={multiple ? "group" : "radiogroup"} aria-label={label} onKeyDown={onKeyDown} className={cn("flex flex-wrap gap-2", className)}>
        {children}
      </div>
    </ChipMode.Provider>
  );
}
