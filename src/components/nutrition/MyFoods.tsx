"use client";

import { useState } from "react";
import Image from "next/image";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { formatAmount } from "@/lib/domain/food-query";
import type { CustomFoodRow } from "@/lib/food/client-data";
import { BasisBadge } from "./FoodBadges";
import styles from "./FoodUi.module.css";

interface MyFoodsProps {
  rows: CustomFoodRow[];
  loading: boolean;
  busy: boolean;
  /** A signed link to the food's photo, when it has one. */
  photoFor?: (row: CustomFoodRow) => string | null;
  onUse: (row: CustomFoodRow) => void;
  onAdd: () => void;
  onEdit: (row: CustomFoodRow) => void;
  onRemove: (row: CustomFoodRow) => void;
}

/** Your own foods: find, use, edit and delete them. */
export function MyFoods({ rows, loading, busy, photoFor, onUse, onAdd, onEdit, onRemove }: MyFoodsProps) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = needle ? rows.filter((row) => `${row.name} ${row.brand ?? ""} ${row.barcode ?? ""}`.toLowerCase().includes(needle)) : rows;
  return (
    <section className="fitx-panel p-4 sm:p-5">
      <div className={styles.slotHeader}>
        <div>
          <h2 className="font-medium">My foods</h2>
          <p className={styles.muted}>Shown first when you search. Only you can see them, except their names, which the AI coach sends out only with “Use my FITX data” on.</p>
        </div>
        <button type="button" data-food-add onClick={onAdd} className="fitx-button"><Plus size={15}/>Add a food</button>
      </div>
      {rows.length > 6 && <input className="fitx-field mb-3" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find one of your foods" aria-label="Find one of your foods"/>}
      {loading ? <p className={styles.muted}>Loading your foods…</p> : rows.length === 0 ? (
        <div className={styles.callout}>
          <p>You haven&apos;t saved any foods yet. Add a home recipe or a packaged food from its label, or scan a barcode that FITX can&apos;t find.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {shown.map((row) => {
            const grams = Number(row.serving_grams) > 0 ? Number(row.serving_grams) : 100;
            const kcal = Math.round(Number(row.calories_per_100g) * grams / 100);
            const serving = row.serving_size && !/^\d+(\.\d+)?\s*g$/i.test(row.serving_size) ? `${row.serving_size} (${formatAmount(grams)} g)` : `${formatAmount(grams)} g`;
            return (
              <div key={row.id} className={styles.row}>
                {photoFor?.(row) && <Image src={photoFor(row) as string} alt="" width={44} height={44} className={styles.thumb} unoptimized/>}
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>{row.name}</p>
                  <p className={styles.rowMeta}>
                    <span>{row.brand ? `${row.brand} · ` : ""}{serving} · {kcal} kcal</span>
                    {row.origin === "ai_coach" ? <BasisBadge basis="ai_suggested" label="From the AI coach"/> : <BasisBadge basis={row.value_basis ?? "user_entered"}/>}
                    {row.barcode && <span className={styles.tag}>Barcode {row.barcode}</span>}
                  </p>
                </div>
                <button type="button" data-food-use={row.id} onClick={() => onUse(row)} className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs">Use</button>
                {/* Unavailable while something saves, not disabled, so the button pressed keeps the focus. */}
                <button type="button" onClick={() => { if (!busy) onEdit(row); }} aria-disabled={busy || undefined} aria-label={`Edit ${row.name}`} className={`${styles.iconButton} ${styles.actionBusy}`}><Pencil size={15}/></button>
                <button type="button" onClick={() => { if (!busy) onRemove(row); }} aria-disabled={busy || undefined} aria-label={`Delete ${row.name}`} title="Delete (past logs keep their values)" className={`${styles.iconButton} ${styles.actionBusy}`}>
                  <Trash2 size={15}/>
                </button>
              </div>
            );
          })}
          {needle && shown.length === 0 && <p className={styles.muted}>None of your foods match “{filter}”.</p>}
        </div>
      )}
    </section>
  );
}
