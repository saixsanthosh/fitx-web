"use client";

import { useActionState, useEffect, useRef } from "react";
import { IDLE, type FormState } from "@/lib/content/form";
import styles from "./content.module.css";
import { FormFooter } from "./form-footer";
import { keepTyped } from "./keep-typed";

/** Renames a food category everywhere it is used, or clears it (empty new name). */
export function CategoryRename({ action, categories }: { action: (state: FormState, form: FormData) => Promise<FormState>; categories: string[] }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  // Cleared once a rename is saved (the old name is gone); kept as typed when it is refused.
  useEffect(() => {
    if (state.status === "saved") formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={formAction} onSubmit={keepTyped(formAction)} className={styles.form}>
      <div className={`${styles.fieldset} ${styles.grid2}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="rename-from">Category</label>
          <select className={styles.select} id="rename-from" name="from" defaultValue="">
            <option value="" disabled>Choose</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="rename-to">New name</label>
          <input className={styles.input} id="rename-to" name="to" maxLength={120} list="rename-targets" aria-describedby="rename-to-hint" />
          <datalist id="rename-targets">
            {categories.map((category) => <option key={category} value={category} />)}
          </datalist>
          <p className={styles.hint} id="rename-to-hint">Pick an existing name to merge two. Leave empty to clear it.</p>
        </div>
      </div>
      <FormFooter state={state} pending={pending} label="Rename" formRef={formRef} />
    </form>
  );
}
