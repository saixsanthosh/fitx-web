import { Bookmark, CalendarDays, Copy, Pencil, Plus, X } from "lucide-react";
import { formatAmount } from "@/lib/domain/food-query";
import { MACRO_LABEL, sumKnown } from "@/lib/domain/nutrition";
import { entryBasis, entryMissing, isEstimateSnapshot, sameMeal, type MealEntry } from "@/lib/food/client-data";
import { BasisBadge, PortionEstimateBadge } from "./FoodBadges";
import styles from "./FoodUi.module.css";
import diary from "./MealLog.module.css";

interface MealLogProps {
  entries: MealEntry[];
  title: string;
  loading: boolean;
  busy: boolean;
  /** Saved meals and routines need the nutrition v2 database update. */
  templatesReady: boolean;
  /** The sections to list: the four standard ones, then the member's own. */
  sections: readonly string[];
  onEdit: (entry: MealEntry) => void;
  onDelete: (entry: MealEntry) => void;
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
export function MealLog({ entries, title, loading, busy, templatesReady, sections, onEdit, onDelete, onSaveMeal, onSaveDay, onCopyYesterday, onLogFood, onAddTo, onAddSection }: MealLogProps) {
  const unknown = sumKnown(entries).unknown;
  const lacking = (["protein", "carbs", "fat"] as const).filter((key) => unknown[key] > 0);
  return (
    <section className={diary.diary} aria-labelledby="meals-title">
      <div className={diary.head}>
        <h2 id="meals-title" className={diary.title}>Meals <span>{title}</span></h2>
        <div className={diary.tools}>
          {entries.length > 0 && <button type="button" className={styles.textButton} disabled={busy} onClick={onCopyYesterday}><Copy size={13} className="mr-1 inline" aria-hidden="true"/>Copy yesterday</button>}
          {templatesReady && entries.length > 0 && <button type="button" className={styles.textButton} disabled={busy} onClick={onSaveDay}><CalendarDays size={13} className="mr-1 inline" aria-hidden="true"/>Save today as a routine</button>}
          <button type="button" className={styles.textButton} onClick={onAddSection}><Plus size={13} className="mr-1 inline" aria-hidden="true"/>Add a meal</button>
        </div>
      </div>
      {/* The day's overview already counts the estimates; the diary names only the values left out. */}
      {lacking.length > 0 && <p className={diary.note}>
        {lacking.length > 0 && `${lacking.map((key) => `${unknown[key]} without ${MACRO_LABEL[key]}`).join(", ")}: left out of totals, not counted as 0 g.`}
      </p>}
      {loading && !entries.length ? <p className={styles.muted}>Loading meals…</p> : entries.length === 0 ? (
        <div className={diary.empty}>
          <p className={diary.emptyTitle}>Nothing logged yet</p>
          <div className={styles.toolbar}>
            <button type="button" className="fitx-button min-h-11 px-4 text-sm" onClick={onLogFood}><Plus size={15} aria-hidden="true"/>Log a food</button>
            <button type="button" className="fitx-button fitx-button-secondary min-h-11 px-4 text-sm" disabled={busy} onClick={onCopyYesterday}>Copy yesterday&apos;s meals</button>
          </div>
        </div>
      ) : (
        <div className={diary.meals}>
          {sections.map((slot) => {
            const rows = entries.filter((entry) => sameMeal(entry.meal, slot));
            const kcal = Math.round(sumKnown(rows).calories);
            return (
              <div key={slot} className={diary.meal}>
                <div className={diary.mealHead}>
                  <h3 className={diary.mealTitle}>{slot}</h3>
                  <span className={diary.mealKcal}>{rows.length ? `${kcal.toLocaleString()} kcal` : ""}</span>
                  {templatesReady && rows.length > 0 && <button type="button" className={styles.iconButton} disabled={busy} onClick={() => onSaveMeal(slot)} aria-label={`Save ${slot.toLowerCase()} as a meal`} title="Save this meal"><Bookmark size={15} aria-hidden="true"/></button>}
                  <button type="button" className={diary.add} onClick={() => onAddTo(slot)} aria-label={`Add food to ${slot}`}><Plus size={16} aria-hidden="true"/></button>
                </div>
                {rows.length > 0 && <ul className={diary.rows}>{rows.map((row) => <EntryRow key={row.id} entry={row} onEdit={onEdit} onDelete={onDelete}/>)}</ul>}
              </div>
            );
          })}
        </div>
      )}
    </section>
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
          <BasisBadge basis={entryBasis(entry)}/>
        </p>
        <p className={styles.rowMacros}>{macro("P", "protein")} · {macro("C", "carbs")} · {macro("F", "fat")}</p>
      </div>
      <span className={diary.rowKcal}>{Math.round(Number(entry.calories))}<small>kcal</small></span>
      <button type="button" onClick={() => onEdit(entry)} aria-label={`Edit ${entry.food_name}`} className={styles.iconButton}><Pencil size={15} aria-hidden="true"/></button>
      <button type="button" onClick={() => onDelete(entry)} aria-label={`Remove ${entry.food_name}`} className={styles.iconButton}><X size={15} aria-hidden="true"/></button>
    </li>
  );
}
