"use client";

import { useState } from "react";
import { Eye, EyeOff, ImageOff } from "lucide-react";
import { ExerciseMovementFrames } from "@/components/exercises/ExerciseMedia";

const HIDE_KEY = "fitx:workout:demo:v1";

function readHidden(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(HIDE_KEY) === "hidden"; } catch { return false; }
}
function writeHidden(hidden: boolean) {
  try { window.localStorage.setItem(HIDE_KEY, hidden ? "hidden" : "shown"); } catch { /* A per-device convenience only. */ }
}

/**
 * The current exercise's demonstration, shown by default as the visual focus of the live workout (its photos, or a
 * looping video once one exists). A member who knows the movement can hide it; this device remembers the choice.
 */
export function ExerciseDemo({ exerciseId, name }: { exerciseId: string | null; name: string }) {
  // Only rendered once the session has loaded in the browser, so the saved choice can be read straight away.
  const [hidden, setHidden] = useState(readHidden);
  const toggle = (next: boolean) => { setHidden(next); writeHidden(next); };

  if (!exerciseId) {
    return (
      <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-fitx-border bg-fitx-surface-variant px-5 py-6 text-center">
        <div>
          <ImageOff size={22} aria-hidden="true" className="mx-auto mb-2 text-fitx-text-disabled" />
          <p className="m-0 text-sm text-fitx-text-secondary">This exercise isn’t in the library, so there are no photos of it.</p>
        </div>
      </div>
    );
  }
  if (hidden) {
    return (
      <button type="button" onClick={() => toggle(false)} className="fitx-button fitx-button-secondary min-h-11 w-full text-sm">
        <Eye size={15} aria-hidden="true" />Show the demonstration
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <ExerciseMovementFrames exerciseId={exerciseId} name={name} />
      <button type="button" onClick={() => toggle(true)} className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-fitx-text-secondary hover:text-fitx-text">
        <EyeOff size={15} aria-hidden="true" />Hide the demonstration
      </button>
    </div>
  );
}
