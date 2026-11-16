"use client";

import { useState } from "react";
import Image from "next/image";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { formatAmount } from "@/lib/domain/food-query";
import type { CustomFoodRow } from "@/lib/food/client-data";
import { BasisBadge } from "./FoodBadges";
import styles from "./FoodUi.module.css";

interface MyFoodsProps {
  rows: CustomFoodRow[];
  loading: boolean;
  /** Archiving, barcodes and labels need the nutrition v2 database update; until then removing deletes. */
  v2: boolean;
  busy: boolean;
  /** A signed link to the food's photo, when it has one. */
  photoFor?: (row: CustomFoodRow) => string | null;
  onUse: (row: CustomFoodRow) => void;
  onAdd: () => void;
  onEdit: (row: CustomFoodRow) => void;
  onRemove: (row: CustomFoodRow) => void;
}

/** Your own foods: find, use, edit and archive them. */
export function MyFoods({ rows, loading, v2, busy, photoFor, onUse, onAdd, onEdit, onRemove }: MyFoodsProps) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = needle ? rows.filter((row) => `${row.name} ${row.brand ?? ""} ${row.barcode ?? ""}`.toLowerCase().includes(needle)) : rows;
  return (
    <section className="fitx-panel p-4 sm:p-5">
      <div className={styles.slotHeader}>
        <div>
          <h2 className="font-medium">My foods</h2>
          <p className={styles.muted}>Foods and recipes you saved. They show up first when you search. Only you can see them, except their names, which the AI coach sends to outside AI services if you use it with “Use my FITX data” on.</p>
        </div>
        <button type="button" onClick={onAdd} className="fitx-button"><Plus size={15}/>Add a food</button>
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
                <button type="button" onClick={() => onUse(row)} className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs">Use</button>
                <button type="button" onClick={() => onEdit(row)} disabled={busy} aria-label={`Edit ${row.name}`} className={styles.iconButton}><Pencil size={15}/></button>
                <button type="button" onClick={() => onRemove(row)} disabled={busy} aria-label={v2 ? `Archive ${row.name}` : `Delete ${row.name}`} title={v2 ? "Archive (past logs keep their values)" : "Delete (past logs keep their values)"} className={styles.iconButton}>
                  {v2 ? <Archive size={15}/> : <Trash2 size={15}/>}
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
