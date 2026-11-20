"use client";

import type { KeyboardEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, X } from "lucide-react";
import { cameraRuleFor } from "@/lib/form-rules/catalog";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { cn } from "@/lib/utils";
import { formatClock } from "./CoachStage";
import type { CameraCountResult } from "./FormCoach";
import { FormCoach } from "./FormCoach";
import { lockScroll } from "./scroll-lock";

export interface CountWithCameraProps {
  /** The workout exercise: its exercise_library id and/or its name. */
  exercise: { id?: string | null; name?: string | null };
  /** This set's target: reps, or seconds for a plank. */
  target?: number | null;
  /** Shown in the sheet, e.g. "Set 2". */
  setLabel?: string;
  /** The confirmed count. Only this number leaves the camera coach. */
  onUse: (result: CameraCountResult) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * "Count with camera" for a live workout set. Renders nothing for exercises the camera can't
 * count, so a workout screen can mount it on every set. The count is handed back only after the
 * user confirms it; the workout screen then fills the set's reps (or seconds) for review.
 */
export function CountWithCamera({ exercise, target, setLabel, onUse, disabled, className }: CountWithCameraProps) {
  const rule = useMemo(() => cameraRuleFor({ id: exercise.id, name: exercise.name }), [exercise.id, exercise.name]);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!rule) return null;

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)} disabled={disabled} className={cn("fitx-button fitx-button-secondary min-h-11", className)}>
        <Camera size={16} aria-hidden="true" />
        Count with camera
      </button>
      {open && createPortal(
        <CameraCountSheet
          rule={rule}
          target={target ?? null}
          setLabel={setLabel}
          onClose={close}
          onUse={(result) => {
            close();
            onUse(result);
          }}
        />,
        document.body,
      )}
    </>
  );
}

function CameraCountSheet({ rule, target, setLabel, onClose, onUse }: { rule: ExerciseRule; target: number | null; setLabel?: string; onClose: () => void; onUse: (result: CameraCountResult) => void }) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const hold = rule.motion.kind === "hold";
  const context = [setLabel, target ? `target ${hold ? formatClock(target) : `${target} reps`}` : null].filter(Boolean).join(" · ");

  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
    return lockScroll();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The live camera view handles its own Escape (it ends counting first).
    if (event.key === "Escape" && !event.defaultPrevented) onClose();
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown} className="fixed inset-0 z-[65] overflow-y-auto bg-fitx-bg text-fitx-text">
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-[max(env(safe-area-inset-top),16px)] sm:px-6 sm:pt-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">Count with camera</h2>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close without using a count" className="grid h-11 w-11 place-items-center rounded-full border border-fitx-border text-fitx-text-secondary transition-colors hover:bg-fitx-hover hover:text-fitx-text">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <FormCoach rule={rule} mode="workout" target={target} context={context || undefined} onUse={onUse} onDiscard={onClose} />
      </div>
    </div>
  );
}
