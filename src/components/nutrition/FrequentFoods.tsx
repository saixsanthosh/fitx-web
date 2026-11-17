import { Plus } from "lucide-react";
import type { FrequentFood } from "@/lib/food/client-data";
import styles from "./FoodUi.module.css";

/**
 * Foods the member logged at least twice in the last 30 days, most often first. Tapping the name chooses the food to
 * set another amount; "Add" logs the amount they usually have into the meal that suits the time of day.
 */
export function FrequentFoods({ items, meal, busy, onAdd, onChoose }: { items: readonly FrequentFood[]; meal: string; busy: boolean; onAdd: (item: FrequentFood) => void; onChoose: (item: FrequentFood) => void }) {
  if (!items.length) return null;
  return (
    <section aria-label="Frequent foods" className={styles.frequent}>
      <p className={styles.frequentLabel}>Frequent · your last 30 days</p>
      {items.map((item) => (
        <div key={item.key} className={styles.frequentRow}>
          <button type="button" className={styles.frequentName} onClick={() => onChoose(item)}>
            <span>{item.name}</span>
            <small>{item.amountText} · {Math.round(Number(item.entry.calories))} kcal · logged {item.count} times</small>
          </button>
          <button type="button" className="fitx-button fitx-button-secondary min-h-11 px-3 text-xs" disabled={busy} onClick={() => onAdd(item)} aria-label={`Add usual amount of ${item.name} to ${meal}`}><Plus size={14}/>Add</button>
        </div>
      ))}
    </section>
  );
}
