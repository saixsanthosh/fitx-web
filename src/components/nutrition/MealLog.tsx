import { Bookmark, CalendarDays, Copy, Pencil, Plus, Utensils, X } from "lucide-react";
import { formatAmount } from "@/lib/domain/food-query";
import { MACRO_LABEL, sumKnown } from "@/lib/domain/nutrition";
import { entryBasis, entryMissing, isEstimateSnapshot, sameMeal, type MealEntry } from "@/lib/food/client-data";
import { BasisBadge, PortionEstimateBadge } from "./FoodBadges";
import styles from "./FoodUi.module.css";

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
  onAddSection: () => void;
}

/** An entry counts as an estimate when its values or its grams are (typical recipe, AI suggestion, portion weight). */
export function isEstimateEntry(entry: MealEntry): boolean {
  return isEstimateSnapshot(entry);
}

export function MealLog({ entries, title, loading, busy, templatesReady, sections, onEdit, onDelete, onSaveMeal, onSaveDay, onCopyYesterday, onLogFood, onAddSection }: MealLogProps) {
  const estimates = entries.filter(isEstimateEntry).length;
  const unknown = sumKnown(entries).unknown;
  const lacking = (["protein", "carbs", "fat"] as const).filter((key) => unknown[key] > 0);
  return (
    <section className="fitx-panel p-4 sm:p-5">
      <div className={styles.slotHeader}>
        <h2 className="font-medium">Meals · {title}</h2>
        <div className={styles.toolbar}>
          <button type="button" className={styles.textButton} disabled={busy} onClick={onCopyYesterday}><Copy size={13} className="mr-1 inline"/>Copy yesterday</button>
          {templatesReady && entries.length > 0 && <button type="button" className={styles.textButton} disabled={busy} onClick={onSaveDay}><CalendarDays size={13} className="mr-1 inline"/>Save today as a routine</button>}
          <button type="button" className={styles.textButton} onClick={onAddSection}><Plus size={13} className="mr-1 inline"/>Add a meal</button>
        </div>
      </div>
      {estimates > 0 && <p className={`${styles.muted} mb-3`}>Totals include {estimates} estimated {estimates === 1 ? "item" : "items"} (a typical recipe or an average portion weight).</p>}
      {lacking.length > 0 && <p className={`${styles.muted} mb-3`}>{lacking.map((key) => `${unknown[key]} ${unknown[key] === 1 ? "entry has" : "entries have"} no ${MACRO_LABEL[key]} value`).join(", ")}. Totals leave those out instead of counting 0 g.</p>}
      {loading ? <p className={styles.muted}>Loading meals…</p> : entries.length === 0 ? (
        <div className={styles.callout}>
          <p>Nothing logged for this day yet.</p>
          <div className={styles.toolbar}>
            <button type="button" className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs" onClick={onLogFood}>Log a food</button>
            <button type="button" className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs" disabled={busy} onClick={onCopyYesterday}>Copy yesterday&apos;s meals</button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {sections.map((slot) => {
            const rows = entries.filter((entry) => sameMeal(entry.meal, slot));
            return (
              <div key={slot}>
                <div className={styles.slotHeader}>
                  <h3 className={styles.slotTitle}><Utensils size={15} className="text-fitx-primary"/>{slot}<span>{Math.round(sumKnown(rows).calories)} kcal</span></h3>
                  {templatesReady && rows.length > 0 && <button type="button" className={styles.textButton} disabled={busy} onClick={() => onSaveMeal(slot)}><Bookmark size={13} className="mr-1 inline"/>Save this meal</button>}
                </div>
                {rows.length ? <div className={styles.list}>{rows.map((row) => <EntryRow key={row.id} entry={row} onEdit={onEdit} onDelete={onDelete}/>)}</div>
                  : <p className={styles.muted}>Nothing logged yet.</p>}
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
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <p className={styles.rowTitle}>{entry.food_name}{entry.brand ? <span className="text-fitx-text-disabled"> · {entry.brand}</span> : null}</p>
        <p className={styles.rowMeta}>
          <span>{amountText}</span>
          {portion?.estimate && <PortionEstimateBadge/>}
          <BasisBadge basis={entryBasis(entry)}/>
        </p>
        <p className={styles.rowMacros}>{macro("P", "protein")} · {macro("C", "carbs")} · {macro("F", "fat")}</p>
      </div>
      <span className={styles.rowKcal}>{Math.round(Number(entry.calories))} kcal</span>
      <button type="button" onClick={() => onEdit(entry)} aria-label={`Edit ${entry.food_name}`} className={styles.iconButton}><Pencil size={15}/></button>
      <button type="button" onClick={() => onDelete(entry)} aria-label={`Remove ${entry.food_name}`} className={styles.iconButton}><X size={15}/></button>
    </div>
  );
}
