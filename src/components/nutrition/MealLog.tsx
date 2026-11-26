import { Bookmark, CalendarDays, Copy, Pencil, Plus, X } from "lucide-react";
import { formatAmount } from "@/lib/domain/food-query";
import { mealSections } from "@/lib/domain/meal-time";
import { MACRO_LABEL, sumKnown } from "@/lib/domain/nutrition";
import { mealsStatusText, type DayLoad } from "@/lib/domain/nutrition-day";
import { entryBasis, entryMissing, isEstimateSnapshot, sameMeal, type MealEntry } from "@/lib/food/client-data";
import { removedText, undoLabel, type RemovedEntry } from "@/lib/food/meal-undo";
import type { DayActionLabels } from "@/app/(dashboard)/nutrition/day-labels";
import { BasisBadge, PortionEstimateBadge } from "./FoodBadges";
import styles from "./FoodUi.module.css";
import diary from "./MealLog.module.css";

interface MealLogProps {
  /** This day's entries; empty until the day has loaded. */
  entries: MealEntry[];
  title: string;
  /** The day buttons in the viewed day's words ("Copy yesterday" on today, "Copy the day before" on other days). */
  labels: DayActionLabels;
  /** Whether this day's meals are in (another day's are never shown under this day's date). */
  state: DayLoad;
  busy: boolean;
  /** Saved meals and routines need the nutrition v2 database update. */
  templatesReady: boolean;
  /** The sections to list: the four standard ones, then the member's own. */
  sections: readonly string[];
  onEdit: (entry: MealEntry) => void;
  onDelete: (entry: MealEntry) => void;
  /** Foods removed from this day, each shown in its meal with an Undo (it takes the focus when the row goes). */
  removed: readonly RemovedEntry[];
  onUndoRemove: (entry: RemovedEntry) => void;
  onSaveMeal: (slot: string) => void;
  onSaveDay: () => void;
  onCopyYesterday: () => void;
  onLogFood: () => void;
  /** Opens Log food with this meal chosen. */
  onAddTo: (slot: string) => void;
  onAddSection: () => void;
}

/** An entry counts as an estimate when its values or its grams are (typical recipe, AI suggestion, portion weight). */
export function isEstimateEntry(entry: MealEntry): boolean {
  return isEstimateSnapshot(entry);
}

/**
 * The day's diary: each meal with its total and a quiet add button, the entries as plain rows. Totals leave out
 * unknown values (they are never counted as 0 g) and say so.
 */
export function MealLog({ entries, title, labels, state, busy, templatesReady, sections, onEdit, onDelete, removed: removedFoods, onUndoRemove, onSaveMeal, onSaveDay, onCopyYesterday, onLogFood, onAddTo, onAddSection }: MealLogProps) {
  // A removed food's Undo shows once its row is gone (the day has reloaded), and goes once it is back.
  const removed = removedFoods.filter((item) => !entries.some((entry) => entry.id === item.id));
  const unknown = sumKnown(entries).unknown;
  // Each Undo sits in its own meal, never moved above the meals: a section whose last food was removed is still drawn
  // (the page lists it while its Undo stands, in the same place, so the Undo keeps the focus when the day reloads).
  const listed = mealSections(sections, removedFoods.map((item) => item.meal));
  const undo = (item: RemovedEntry) => <RemovedRow key={`removed-${item.id}`} entry={item} onUndo={onUndoRemove}/>;
  const lacking = (["protein", "carbs", "fat"] as const).filter((key) => unknown[key] > 0);
  return (
    <section className={diary.diary} aria-labelledby="meals-title">
      <div className={diary.head}>
        {/* Focusable from script only: focus comes here when the control that had it leaves the day. */}
        <h2 id="meals-title" tabIndex={-1} className={diary.title}>Meals <span>{title}</span></h2>
        <div className={diary.tools}>
          {/* Unavailable while saving, not disabled, so the button pressed keeps the focus. */}
          {entries.length > 0 && <button type="button" className={`${styles.textButton} ${styles.actionBusy}`} aria-disabled={busy || undefined} onClick={() => { if (!busy) onCopyYesterday(); }}><Copy size={13} className="mr-1 inline" aria-hidden="true"/>{labels.copy}</button>}
          {templatesReady && entries.length > 0 && <button type="button" className={`${styles.textButton} ${styles.actionBusy}`} aria-disabled={busy || undefined} onClick={() => { if (!busy) onSaveDay(); }}><CalendarDays size={13} className="mr-1 inline" aria-hidden="true"/>{labels.saveDay}</button>}
          <button type="button" className={styles.textButton} onClick={onAddSection}><Plus size={13} className="mr-1 inline" aria-hidden="true"/>Add a meal</button>
        </div>
      </div>
      {/* The day's overview already counts the estimates; the diary names only the values left out. */}
      {lacking.length > 0 && <p className={diary.note}>
        {lacking.length > 0 && `${lacking.map((key) => `${unknown[key]} without ${MACRO_LABEL[key]}`).join(", ")}: left out of totals, not counted as 0 g.`}
      </p>}
      {state !== "ready" ? <p role="status" className={styles.muted}>{mealsStatusText(state)}</p> : entries.length === 0 ? (
        <div className={diary.empty}>
          {removed.length > 0 && <ul className={diary.orphans}>{removed.map(undo)}</ul>}
          <p className={diary.emptyTitle}>Nothing logged yet</p>
          <div className={styles.toolbar}>
            <button type="button" className="fitx-button min-h-11 px-4 text-sm" onClick={onLogFood}><Plus size={15} aria-hidden="true"/>Log a food</button>
            <button type="button" className={`fitx-button fitx-button-secondary min-h-11 px-4 text-sm ${styles.actionBusy}`} aria-disabled={busy || undefined} onClick={() => { if (!busy) onCopyYesterday(); }}>{labels.copyEmpty}</button>
          </div>
        </div>
      ) : (
        <div className={diary.meals}>
          {listed.map((slot) => {
            const rows = entries.filter((entry) => sameMeal(entry.meal, slot));
            const gone = removed.filter((item) => sameMeal(item.meal, slot));
            const kcal = Math.round(sumKnown(rows).calories);
            return (
              <div key={slot} className={diary.meal}>
                <div className={diary.mealHead}>
                  <h3 className={diary.mealTitle}>{slot}</h3>
                  <span className={diary.mealKcal}>{rows.length ? `${kcal.toLocaleString()} kcal` : ""}</span>
                  {templatesReady && rows.length > 0 && <button type="button" className={`${styles.iconButton} ${styles.actionBusy}`} aria-disabled={busy || undefined} onClick={() => { if (!busy) onSaveMeal(slot); }} aria-label={`Save ${slot.toLowerCase()} as a meal`} title="Save this meal"><Bookmark size={15} aria-hidden="true"/></button>}
                  <button type="button" data-meal-add={slot} className={diary.add} onClick={() => onAddTo(slot)} aria-label={`Add food to ${slot}`}><Plus size={16} aria-hidden="true"/></button>
                </div>
                {rows.length + gone.length > 0 && <ul className={diary.rows}>{rows.map((row) => <EntryRow key={row.id} entry={row} onEdit={onEdit} onDelete={onDelete}/>)}{gone.map(undo)}</ul>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** A removed food: what was removed, and Undo, which puts it back as it was. */
function RemovedRow({ entry, onUndo }: { entry: RemovedEntry; onUndo: (entry: RemovedEntry) => void }) {
  return (
    <li className={diary.removed}>
      <p role="status" className={diary.removedText}>{removedText(entry)}</p>
      <button type="button" data-undo={entry.id} onClick={() => onUndo(entry)} aria-label={undoLabel(entry)} className={styles.textButton}>Undo</button>
    </li>
  );
}

function EntryRow({ entry, onEdit, onDelete }: { entry: MealEntry; onEdit: (entry: MealEntry) => void; onDelete: (entry: MealEntry) => void }) {
  const portion = entry.nutrition_snapshot?.portion;
  const grams = Number(entry.quantity_grams) || Number(entry.servings) * 100;
  const amountText = portion && entry.serving_size ? entry.serving_size : `${formatAmount(grams)} g`;
  const missing = entryMissing(entry);
  const macro = (letter: string, key: "protein" | "carbs" | "fat") => (missing.includes(key) ? `${letter} unknown` : `${letter} ${Math.round(Number(entry[key]))} g`);
  return (
    <li className={diary.row}>
      <div className={diary.rowMain}>
        <p className={diary.rowTitle}>{entry.food_name}{entry.brand ? <span> · {entry.brand}</span> : null}</p>
        <p className={styles.rowMeta}>
          <span>{amountText}</span>
          {portion?.estimate && <PortionEstimateBadge/>}
          <BasisBadge basis={entryBasis(entry)} source={entry.source}/>
        </p>
        <p className={styles.rowMacros}>{macro("P", "protein")} · {macro("C", "carbs")} · {macro("F", "fat")}</p>
      </div>
      <span className={diary.rowKcal}>{Math.round(Number(entry.calories))}<small>kcal</small></span>
      <button type="button" data-entry-edit={entry.id} onClick={() => onEdit(entry)} aria-label={`Edit ${entry.food_name}`} className={styles.iconButton}><Pencil size={15} aria-hidden="true"/></button>
      <button type="button" data-entry-remove={entry.id} onClick={() => onDelete(entry)} aria-label={`Remove ${entry.food_name}`} className={styles.iconButton}><X size={15} aria-hidden="true"/></button>
    </li>
  );
}
