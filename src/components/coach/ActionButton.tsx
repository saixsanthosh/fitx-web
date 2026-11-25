"use client";

import { useCallback, useRef } from "react";
import Link from "next/link";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActionState = "proposed" | "applying" | "applied" | "dismissed" | "error";

/** "Add to My Food Plan" (saved to My foods in Nutrition) / "Save as a workout draft", and what happened after the press. */
export function ActionButton({
  state,
  onApply,
  label,
  doneLabel,
  doneHref,
  doneLinkLabel,
  size = "small",
  describedBy,
}: {
  state: ActionState;
  onApply: () => void;
  label: string;
  doneLabel: string;
  doneHref: string;
  doneLinkLabel: string;
  size?: "small" | "regular";
  describedBy?: string;
}) {
  // The button stays focusable while adding (aria-disabled), and once it is replaced by "Saved" and its link, focus
  // moves to the link, if the member pressed it from the keyboard and focus has not gone anywhere else (BRIEF-3 D5).
  const pressed = useRef(false);
  const takeFocus = useCallback((link: HTMLAnchorElement | null) => {
    if (!link || !pressed.current) return;
    pressed.current = false;
    if (!document.activeElement || document.activeElement === document.body) link.focus();
  }, []);

  if (state === "applied") {
    return (
      <span className="inline-flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-fitx-success"><Check size={16} aria-hidden="true" />{doneLabel}</span>
        <Link ref={takeFocus} href={doneHref} className="font-medium text-fitx-primary-text underline-offset-4 hover:underline">{doneLinkLabel}</Link>
      </span>
    );
  }
  if (state === "dismissed") return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        if (state === "applying") return;
        pressed.current = event.currentTarget === document.activeElement;
        onApply();
      }}
      aria-disabled={state === "applying" || undefined}
      aria-describedby={describedBy}
      className={cn("fitx-button shrink-0 aria-disabled:opacity-60", size === "small" ? "min-h-11 px-3.5 text-sm" : "")}
    >
      <Plus size={16} aria-hidden="true" />
      {state === "applying" ? "Adding…" : state === "error" ? "Try again" : label}
    </button>
  );
}
