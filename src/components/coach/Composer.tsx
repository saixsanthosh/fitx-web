"use client";

import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Dumbbell, MessageCircle, Square, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPOSER_MODES, MESSAGE_MAX as MAX, composerModes, lengthNotice, nextMode, radioTabStop, type ComposerMode } from "./composer-rules";

export type { ComposerMode };

const MODES: Array<{ id: ComposerMode; label: string; short: string; icon: typeof MessageCircle }> = [
  { id: "chat", label: "Ask", short: "Ask", icon: MessageCircle },
  { id: "meal_plan", label: "Plan my meals", short: "Meal plan", icon: Utensils },
  { id: "workout_plan", label: "Plan a workout", short: "Workout", icon: Dumbbell },
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
  mealPlansPaused = false,
  busy,
  onSend,
  onStop,
  hint,
  focusKey = 0,
  voice,
}: {
  draft: string;
  onDraft: (value: string) => void;
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  budget: string;
  onBudget: (value: string) => void;
  plansAllowed: boolean;
  plansNote: string | null;
  /** The 30 days after FITX's eating-disorder note: "Plan my meals" is not offered (composerModes). */
  mealPlansPaused?: boolean;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
  hint: string | null;
  /** Changing this moves focus into the message box (after a suggestion is chosen). */
  focusKey?: number;
  /** Push to talk and read aloud (CoachVoice), shown beside Send when the browser supports them. */
  voice?: ReactNode;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const budgetId = useId();
  const hintId = useId();
  const counterId = useId();
  const canSend = !busy && (mode !== "chat" || draft.trim().length > 0) && draft.length <= MAX;
  const offered = composerModes({ plansAllowed, mealPlansPaused });
  // A radio group: one Tab stop (the chosen mode), and the arrow keys move and select (bug 87).
  const choosable = busy ? [] : COMPOSER_MODES.filter((id) => offered[id] === "on");
  const tabStop = radioTabStop(mode, choosable);
  const radios = useRef(new Map<ComposerMode, HTMLButtonElement>());
  // The counter is described, and the length announced, only near or over the limit (bug 88).
  const length = lengthNotice(draft.length);

  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [draft]);

  useEffect(() => {
    if (!focusKey) return;
    const element = area.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, [focusKey]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSend) onSend();
  }

  function onRadioKey(event: KeyboardEvent<HTMLDivElement>) {
    const focused = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]")?.dataset.mode as ComposerMode | undefined;
    const next = focused ? nextMode(focused, event.key, choosable) : null;
    if (!next) return;
    event.preventDefault();
    if (next !== mode) onMode(next);
    radios.current.get(next)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-fitx-border bg-fitx-card p-2 shadow-lg" aria-label="Message the coach">
      <div role="radiogroup" aria-label="What do you want?" onKeyDown={onRadioKey} className="flex gap-1 overflow-x-auto px-1 pb-2 pt-1 [scrollbar-width:none]">
        {MODES.filter(({ id }) => offered[id] !== "hidden").map(({ id, label, short, icon: Icon }) => {
          const disabled = offered[id] !== "on";
          return (
            <button
              key={id}
              ref={(element) => {
                if (element) radios.current.set(id, element);
                else radios.current.delete(id);
              }}
              type="button"
              role="radio"
              data-mode={id}
              aria-checked={mode === id}
              tabIndex={id === tabStop ? 0 : -1}
              disabled={disabled || busy}
              onClick={() => onMode(id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                mode === id ? "border-fitx-primary bg-fitx-primary/10 font-semibold text-fitx-primary-text" : "border-fitx-border text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text",
              )}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="sm:hidden" aria-hidden="true">{short}</span>
              <span className="sr-only sm:not-sr-only">{label}</span>
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
          aria-describedby={length.shown ? `${hintId} ${counterId}` : hintId}
          className="max-h-[168px] min-h-11 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[15px] leading-6 text-fitx-text outline-none placeholder:text-fitx-text-disabled"
        />
        {voice}
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
        <span id={hintId}>
          {!plansAllowed && plansNote && mode === "chat" ? `${plansNote} ` : hint ? `${hint} · ` : null}
          <span className="whitespace-nowrap">Not medical advice.</span>
        </span>
        {length.shown && (
          <span id={counterId} className={cn(length.over && "text-fitx-danger")}>
            <span aria-hidden="true">{draft.length}/{MAX}</span>
            <span className="sr-only">{draft.length} of {MAX} characters</span>
          </span>
        )}
        {/* Changes only when the message comes near or goes over the limit, so typing is not read out key by key. */}
        <span className="sr-only" aria-live="polite">{length.live}</span>
      </div>
    </form>
  );
}
