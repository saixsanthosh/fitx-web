"use client";

import { useActionState, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { MAX_PORTIONS } from "@/lib/content/food-input";
import { IDLE, type FormState } from "@/lib/content/form";
import { PORTION_UNITS, PORTION_UNIT_LABELS } from "@/lib/content/vocabulary";
import styles from "./content.module.css";
import { FormFooter } from "./form-footer";

export type PortionDraft = { key: number; label: string; unit: string; grams: string; measured: boolean };

/**
 * Household portions ("1 idli", "1 katori"): what a member picks instead of grams. The default is what a
 * bare count uses ("3 idlis" is 3 of it). Average measures are shown to members as estimates.
 */
export function PortionsEditor({ action, initial, initialDefault }: { action: (state: FormState, form: FormData) => Promise<FormState>; initial: Omit<PortionDraft, "key">[]; initialDefault: number }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const nextKey = useRef(initial.length);
  const [rows, setRows] = useState<PortionDraft[]>(() => initial.map((row, key) => ({ ...row, key })));
  const [defaultKey, setDefaultKey] = useState<number | null>(initialDefault >= 0 ? initialDefault : null);

  const add = () => {
    if (rows.length >= MAX_PORTIONS) return;
    const key = nextKey.current++;
    setRows([...rows, { key, label: "", unit: "piece", grams: "", measured: false }]);
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>(`#portion-label-${key}`)?.focus());
  };
  const remove = (key: number) => {
    setRows(rows.filter((row) => row.key !== key));
    if (defaultKey === key) setDefaultKey(null);
  };

  return (
    <form ref={formRef} action={formAction} className={styles.form}>
      <div className={styles.fieldset}>
        {rows.length === 0 && <p className={styles.hint}>No portions yet. Members then log this food in grams.</p>}
        {rows.map((row, index) => (
          <div key={row.key} className={styles.portionRow}>
            <div className={`${styles.field} ${styles.portionLabel}`}>
              <label className={styles.label} htmlFor={`portion-label-${row.key}`}>Portion {index + 1}</label>
              <input className={styles.input} id={`portion-label-${row.key}`} name="portion_label" defaultValue={row.label} maxLength={120} placeholder="1 idli" />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`portion-unit-${row.key}`}>Unit</label>
              <select className={styles.select} id={`portion-unit-${row.key}`} name="portion_unit" defaultValue={row.unit}>
                {PORTION_UNITS.map((unit) => <option key={unit} value={unit}>{PORTION_UNIT_LABELS[unit]}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`portion-grams-${row.key}`}>Weight</label>
              <div className={styles.suffix}>
                <input className={styles.input} id={`portion-grams-${row.key}`} name="portion_grams" inputMode="decimal" defaultValue={row.grams} />
                <span aria-hidden="true">g</span>
              </div>
            </div>
            <div className={styles.portionControls}>
              <label className={styles.toggle}>
                <input type="radio" name="portion_default" value={String(index)} checked={defaultKey === row.key} onChange={() => setDefaultKey(row.key)} />
                Default
              </label>
              <label className={styles.toggle}>
                <select className={styles.select} name="portion_measured" defaultValue={row.measured ? "true" : "false"} aria-label={`Portion ${index + 1} weight`}>
                  <option value="false">Average</option>
                  <option value="true">Weighed</option>
                </select>
              </label>
              <button type="button" className={`${styles.buttonQuiet} ${styles.small}`} onClick={() => remove(row.key)} aria-label={`Remove portion ${index + 1}`}>
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </div>
          </div>
        ))}
        <div>
          <button type="button" className={`${styles.buttonQuiet} ${styles.small}`} onClick={add} disabled={rows.length >= MAX_PORTIONS}>
            <Plus aria-hidden="true" size={15} />
            Add portion
          </button>
        </div>
      </div>
      <FormFooter state={state} pending={pending} label="Save portions" formRef={formRef} />
    </form>
  );
}
