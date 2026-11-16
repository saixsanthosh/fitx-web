"use client";

import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Dumbbell, MessageCircle, Square, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComposerMode = "chat" | "meal_plan" | "workout_plan";
const MAX = 2000;

const MODES: Array<{ id: ComposerMode; label: string; icon: typeof MessageCircle }> = [
  { id: "chat", label: "Ask", icon: MessageCircle },
  { id: "meal_plan", label: "Plan my meals", icon: Utensils },
  { id: "workout_plan", label: "Plan a workout", icon: Dumbbell },
];

const PLACEHOLDER: Record<ComposerMode, string> = {
  chat: "Ask about training, food or recovery…",
  meal_plan: "Anything to include or avoid today? (optional)",
  workout_plan: "Anything to focus on or avoid? (optional)",
};

export function Composer({
  draft,
  onDraft,
  mode,
  onMode,
  budget,
  onBudget,
  plansAllowed,
  plansNote,
  busy,
  onSend,
  onStop,
  hint,
}: {
  draft: string;
  onDraft: (value: string) => void;
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  budget: string;
  onBudget: (value: string) => void;
  plansAllowed: boolean;
  plansNote: string | null;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
  hint: string | null;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const budgetId = useId();
  const hintId = useId();
  const counterId = useId();
  const canSend = !busy && (mode !== "chat" || draft.trim().length > 0) && draft.length <= MAX;

  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [draft]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSend) onSend();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-fitx-border bg-fitx-card p-2 shadow-lg" aria-label="Message the coach">
      <div role="radiogroup" aria-label="What do you want?" className="flex gap-1 overflow-x-auto px-1 pb-2 pt-1">
        {MODES.map(({ id, label, icon: Icon }) => {
          const disabled = id !== "chat" && !plansAllowed;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              disabled={disabled || busy}
              onClick={() => onMode(id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                mode === id ? "border-fitx-primary bg-fitx-primary/10 font-semibold text-fitx-primary-text" : "border-fitx-border text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text",
              )}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      {mode === "meal_plan" && (
        <div className="px-2 pb-2">
          <label htmlFor={budgetId} className="text-xs font-medium text-fitx-text-secondary">Food budget for today <span className="font-normal">(optional)</span></label>
          <input id={budgetId} value={budget} maxLength={60} onChange={(event) => onBudget(event.target.value)} placeholder="For example: ₹250" className="fitx-field mt-1 min-h-11 text-sm" />
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="sr-only" htmlFor={`${hintId}-input`}>Message</label>
        <textarea
          id={`${hintId}-input`}
          ref={area}
          rows={1}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={PLACEHOLDER[mode]}
          aria-describedby={`${hintId} ${counterId}`}
          className="max-h-[168px] min-h-11 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[15px] leading-6 text-fitx-text outline-none placeholder:text-fitx-text-disabled"
        />
        {busy ? (
          <button type="button" onClick={onStop} aria-label="Stop the answer" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-fitx-border text-fitx-text hover:bg-fitx-hover">
            <Square size={15} aria-hidden="true" fill="currentColor" />
          </button>
        ) : (
          <button type="submit" disabled={!canSend} aria-label={mode === "chat" ? "Send" : mode === "meal_plan" ? "Make my meal plan" : "Make my workout"} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fitx-primary text-fitx-on-primary transition-colors hover:bg-fitx-primary-bright disabled:opacity-40">
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 px-2.5 pb-1 pt-1 text-[11px] leading-5 text-fitx-text-secondary">
        <span id={hintId}>{!plansAllowed && plansNote ? plansNote : hint ?? "Not medical advice."}</span>
        <span id={counterId} aria-live="polite" className={cn(draft.length > MAX - 200 ? "" : "sr-only", draft.length > MAX && "text-fitx-danger")}>
          {draft.length}/{MAX}
        </span>
      </div>
    </form>
  );
}
