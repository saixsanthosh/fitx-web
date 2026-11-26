"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, Trash2, Utensils } from "lucide-react";
import { type MealTemplate } from "@/lib/food/client-data";
import { noRoutinesText, type DayActionLabels } from "@/app/(dashboard)/nutrition/day-labels";
import styles from "./FoodUi.module.css";

interface RoutinesProps {
  templates: MealTemplate[];
  ready: boolean;
  /** The routines are being read. Until the first answer the list says so; a reload after a save keeps the rows shown. */
  loading: boolean;
  busy: boolean;
  dateLabel: string;
  /** The Meals tab's day buttons as it shows them for the day viewed, so the hints name buttons that are there. */
  labels: Pick<DayActionLabels, "saveDay">;
  /** The meal sections a saved meal can be added to: the four standard ones, then the member's own. */
  sections: readonly string[];
  onApply: (template: MealTemplate, slot: string | null) => void;
  onDelete: (template: MealTemplate) => void;
}

/** Saved meals and daily routines, applied to the day shown at the top of the page. */
export function Routines({ templates, ready, loading, busy, dateLabel, labels, sections, onApply, onDelete }: RoutinesProps) {
  const [slots, setSlots] = useState<Record<string, string>>({});
  if (!ready) {
    return (
      <section className="fitx-panel p-4 sm:p-5">
        <h2 className="mb-2 font-medium">Saved meals and routines</h2>
        <div className={styles.callout}><p>Saving meals and daily routines needs a database update that hasn&apos;t been applied yet. Until then you can still copy the meals of the day before from the Meals tab.</p></div>
      </section>
    );
  }
  const meals = templates.filter((template) => template.kind === "meal");
  const days = templates.filter((template) => template.kind === "day");
  const group = (title: string, list: MealTemplate[], icon: ReactNode, empty: string) => (
    <div>
      <h3 className={`${styles.slotTitle} mb-2`}>{icon}{title}</h3>
      {list.length === 0 ? <p className={styles.muted}>{empty}</p> : (
        <div className={styles.list}>
          {list.map((template) => {
            const kcal = Math.round(template.items.reduce((sum, item) => sum + Number(item.calories || 0), 0));
            const slot = slots[template.id] ?? template.meal_slot ?? "Breakfast";
            return (
              <div key={template.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>{template.name}</p>
                  <p className={styles.rowMeta}>{template.items.length} {template.items.length === 1 ? "food" : "foods"} · {kcal} kcal{template.kind === "meal" && template.meal_slot ? ` · saved from ${template.meal_slot}` : ""}</p>
                </div>
                {template.kind === "meal" && (
                  <select className="fitx-field w-auto" value={slot} aria-label={`Meal to add ${template.name} to`} onChange={(event) => setSlots((old) => ({ ...old, [template.id]: event.target.value }))}>
                    {sections.map((name) => <option key={name}>{name}</option>)}
                  </select>
                )}
                {/* Unavailable while something saves, not disabled, so the button pressed keeps the focus. */}
                <button type="button" data-routine-add={template.id} disabled={template.items.length === 0} aria-disabled={busy || undefined} onClick={() => { if (!busy) onApply(template, template.kind === "meal" ? slot : null); }} className={`fitx-button fitx-button-secondary min-h-10 px-3 text-xs ${styles.actionBusy}`}>Add to {dateLabel}</button>
                <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) onDelete(template); }} aria-label={`Delete ${template.name}`} className={`${styles.iconButton} ${styles.actionBusy}`}><Trash2 size={15}/></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
  return (
    <section className="fitx-panel space-y-5 p-4 sm:p-5">
      <div>
        {/* Focusable from script only: focus comes here when the routine that had it is deleted. */}
        <h2 id="routines-title" tabIndex={-1} className="font-medium">Saved meals and routines</h2>
        <p className={styles.muted}>Save a meal or a whole day from the Meals tab, then add it to any day in one tap. Amounts and values are copied as they were logged.</p>
      </div>
      {/* Only before the first answer: a reload keeps the rows, so "Add to <day>" keeps the focus once it is added. */}
      {loading && templates.length === 0 ? <p className={styles.muted}>Loading…</p> : <>
        {group("Saved meals", meals, <Utensils size={15} className="text-fitx-primary"/>, "No saved meals yet. Save one from its bookmark on Meals.")}
        {group("Daily routines", days, <CalendarDays size={15} className="text-fitx-primary"/>, noRoutinesText(labels))}
      </>}
    </section>
  );
}
