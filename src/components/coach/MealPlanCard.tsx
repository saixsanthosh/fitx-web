"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import Image from "next/image";
import { CircleCheck, Lightbulb, Utensils, Wallet } from "lucide-react";
import type { CoachFoodItem, CoachMealPlan, CoachSwap } from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { ActionButton, type ActionState } from "./ActionButton";
import { formatNumber, formatGrams } from "./format";

export type PlanActions = {
  stateOf: (actionId: string | null) => ActionState;
  apply: (actionId: string) => void;
  swapsFor: (actionId: string | null) => CoachSwap[];
  requestSwap: (actionId: string, note: string) => Promise<string | null>;
  canSwap: boolean;
};

/** A checked meal plan: every food shows where its values come from, and can be added or swapped. */
export function MealPlanCard({ plan, actions }: { plan: CoachMealPlan; actions: PlanActions }) {
  return (
    <article className="fitx-panel overflow-hidden" aria-label={`Meal plan: ${plan.title}`}>
      <header className="border-b border-fitx-divider p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-[.12em] text-fitx-primary-text">Meal plan</p>
        <h3 className="mt-1 text-lg font-semibold leading-snug text-fitx-text">{plan.title}</h3>
        {plan.summary && <p className="mt-1 text-sm leading-6 text-fitx-text-secondary">{plan.summary}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Calories" value={`${formatNumber(plan.totals.calories)} kcal`} target={plan.target ? `${formatNumber(plan.target.calories)} target` : null} />
          <Stat label="Protein" value={formatGrams(plan.totals.protein)} target={plan.target ? `${plan.target.protein} g target` : null} />
          <Stat label="Carbs" value={formatGrams(plan.totals.carbs)} target={plan.target ? `${plan.target.carbs} g target` : null} />
          <Stat label="Fat" value={formatGrams(plan.totals.fat)} target={plan.target ? `${plan.target.fat} g target` : null} />
        </dl>
        {plan.budget && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-fitx-border px-2.5 py-1 text-xs text-fitx-text-secondary">
            <Wallet size={13} aria-hidden="true" /> Budget: {plan.budget} · costs are approximate
          </p>
        )}
      </header>

      <div className="divide-y divide-fitx-divider">
        {plan.meals.map((meal) => (
          <section key={meal.key} aria-label={meal.name} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-fitx-text">
                {meal.name} <span className="font-normal text-fitx-text-secondary">· {formatNumber(meal.totals.calories)} kcal · {formatGrams(meal.totals.protein)} protein</span>
              </h4>
              {meal.actionId && (
                <ActionButton
                  state={actions.stateOf(meal.actionId)}
                  onApply={() => actions.apply(meal.actionId!)}
                  label="Add whole meal"
                  doneLabel="Saved to My foods"
                  doneHref="/nutrition"
                  doneLinkLabel="Open Nutrition"
                />
              )}
            </div>
            <ul className="mt-3 space-y-3">
              {meal.items.map((item) => <FoodRow key={item.key} item={item} actions={actions} />)}
            </ul>
          </section>
        ))}
      </div>

      {(plan.checks.length > 0 || plan.tips.length > 0) && (
        <footer className="space-y-4 border-t border-fitx-divider bg-fitx-surface-variant/40 p-4 sm:p-5">
          {plan.checks.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[.1em] text-fitx-text-secondary">What FITX checked</h4>
              <ul className="mt-2 space-y-1.5">
                {plan.checks.map((check) => (
                  <li key={check} className="flex gap-2 text-sm leading-6 text-fitx-text"><CircleCheck size={16} aria-hidden="true" className="mt-1 shrink-0 text-fitx-success" />{check}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.tips.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[.1em] text-fitx-text-secondary">Tips</h4>
              <ul className="mt-2 space-y-1.5">
                {plan.tips.map((tip) => (
                  <li key={tip} className="flex gap-2 text-sm leading-6 text-fitx-text"><Lightbulb size={16} aria-hidden="true" className="mt-1 shrink-0 text-fitx-gold" />{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </footer>
      )}
    </article>
  );
}

function Stat({ label, value, target }: { label: string; value: string; target: string | null }) {
  return (
    <div className="rounded-lg bg-fitx-surface-variant/70 px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-[.08em] text-fitx-text-secondary">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-fitx-text">{value}</dd>
      {target && <dd className="text-[11px] text-fitx-text-secondary">{target}</dd>}
    </div>
  );
}

const COST_LABEL: Record<NonNullable<CoachFoodItem["cost"]>, string> = { low: "Low cost", medium: "Medium cost", high: "Higher cost" };

const BASIS_STYLE: Record<CoachFoodItem["basis"], string> = {
  database: "border-fitx-success-border bg-fitx-success-bg text-fitx-success",
  label: "border-fitx-border text-fitx-info",
  ai_estimate: "border-fitx-border bg-fitx-surface-variant text-fitx-warning",
};

function FoodRow({ item, actions, nested = false }: { item: CoachFoodItem; actions: PlanActions; nested?: boolean }) {
  const [swapOpen, setSwapOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [swapError, setSwapError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const noteId = useId();
  const detailId = useId();
  const swapToggle = useRef<HTMLButtonElement>(null);
  const swaps = actions.swapsFor(item.actionId);

  async function findSwap(event: FormEvent) {
    event.preventDefault();
    // "Find a swap" stays focusable while it works (aria-disabled), so a refusal's message is read with focus kept.
    if (!item.actionId || busy) return;
    setBusy(true);
    setSwapError("");
    const error = await actions.requestSwap(item.actionId, note.trim());
    setBusy(false);
    if (error) {
      setSwapError(error);
      return;
    }
    // The form closes and the swap appears below the food: focus goes back to the button that opened the form.
    flushSync(() => setSwapOpen(false));
    swapToggle.current?.focus();
  }

  return (
    <li className={cn("rounded-lg border border-fitx-border bg-fitx-card p-3", nested && "border-dashed")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          {item.image && !imageFailed ? (
            // Small label photos load straight from Open Food Facts: no optimizer round trip to time out.
            <Image src={item.image} alt="" width={44} height={44} unoptimized onError={() => setImageFailed(true)} className="h-11 w-11 shrink-0 rounded-md border border-fitx-border bg-fitx-surface object-cover" />
          ) : (
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-fitx-surface-variant text-fitx-text-disabled"><Utensils size={18} /></span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fitx-text">{item.name}</p>
            <p id={detailId} className="mt-0.5 text-sm text-fitx-text-secondary">
              {item.portion} · <span className="font-medium text-fitx-text">{formatNumber(item.calories)} kcal</span>
            </p>
            <p className="mt-0.5 text-xs text-fitx-text-secondary">Protein {formatGrams(item.protein)} · Carbs {formatGrams(item.carbs)} · Fat {formatGrams(item.fat)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", BASIS_STYLE[item.basis])} title={item.matchedName ? `Values from: ${item.matchedName}` : "Not in FITX's food data yet"}>
                {item.basisLabel}
              </span>
              {item.portionEstimated && item.basis !== "ai_estimate" && <span className="rounded-full border border-fitx-border px-2 py-0.5 text-[11px] text-fitx-text-secondary">Portion weight estimated</span>}
              {item.cost && <span className="rounded-full border border-fitx-border px-2 py-0.5 text-[11px] text-fitx-text-secondary">{COST_LABEL[item.cost]}</span>}
            </div>
            {item.source && <p className="mt-1.5 text-[11px] leading-4 text-fitx-text-secondary">Source: {item.source}{item.matchedName ? ` (${item.matchedName})` : ""}</p>}
            {item.note && <p className="mt-1.5 text-xs leading-5 text-fitx-text-secondary">{item.note}</p>}
          </div>
        </div>
        {item.actionId && (
          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            <ActionButton state={actions.stateOf(item.actionId)} onApply={() => actions.apply(item.actionId!)} label="Add to My Food Plan" doneLabel="Saved to My foods" doneHref="/nutrition" doneLinkLabel="View in Nutrition" describedBy={detailId} />
            {actions.canSwap && !nested && (
              <button ref={swapToggle} type="button" onClick={() => setSwapOpen((open) => !open)} aria-expanded={swapOpen} className="min-h-11 text-sm font-medium text-fitx-text-secondary underline-offset-4 hover:text-fitx-text hover:underline">
                Can&apos;t afford this?
              </button>
            )}
          </div>
        )}
      </div>

      {swapOpen && (
        <form onSubmit={findSwap} className="mt-3 border-t border-fitx-divider pt-3">
          <label htmlFor={noteId} className="text-sm font-medium text-fitx-text">What can you get or afford instead? <span className="font-normal text-fitx-text-secondary">(optional)</span></label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input id={noteId} value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="For example: chana, eggs, local rice" className="fitx-field" />
            <button type="submit" aria-disabled={busy || undefined} className="fitx-button fitx-button-secondary shrink-0 aria-disabled:opacity-60">{busy ? "Finding…" : "Find a swap"}</button>
          </div>
          {swapError && <p role="alert" className="fitx-alert fitx-alert-danger mt-2">{swapError}</p>}
        </form>
      )}

      {swaps.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-fitx-divider pt-3" aria-label={`Swaps for ${item.name}`}>
          {swaps.map((swap) => (
            <li key={swap.item.key}>
              <p className="mb-2 text-xs leading-5 text-fitx-text-secondary"><span className="font-semibold text-fitx-text">Swap:</span> {swap.note}</p>
              <ul><FoodRow item={swap.item} actions={actions} nested /></ul>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
