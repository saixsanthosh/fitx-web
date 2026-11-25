"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import styles from "./FoodUi.module.css";

/**
 * Asks for a name, for saving a meal or a day's routine, or for a new meal section. A modal Sheet (native dialog):
 * focus starts on the name, stays inside, Escape closes, and focus goes back to the button that opened it.
 */
export function NameDialog({ title, description, initial, busy, label = "Name", maxLength = 80, validate, onCancel, onSave }: {
  title: string;
  description: string;
  initial: string;
  busy: boolean;
  /** The field's label ("Name" by default). */
  label?: string;
  maxLength?: number;
  /** A reason the typed name cannot be used, shown under the field, or null. */
  validate?: (name: string) => string | null;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // The dialog is open by now (Sheet opens it in a layout effect): the name is ready to type over.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <Sheet open onClose={onCancel} side="center" title={title} description={description}>
      <form className={styles.form} noValidate onSubmit={(event) => {
        event.preventDefault();
        // Saving: a second press does nothing, and the button keeps the focus (it is never disabled under it).
        if (busy) return;
        const reason = validate?.(name) ?? (name.trim() ? null : `Enter a ${label.toLowerCase()}.`);
        if (reason) { setProblem(reason); input.current?.focus(); return; }
        onSave(name.trim());
      }}>
        <label className={styles.wide}>{label}<input ref={input} className="fitx-field" required maxLength={maxLength} value={name} aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "name-dialog-problem" : undefined} onChange={(event) => { setName(event.target.value); setProblem(""); }}/></label>
        {problem && <p id="name-dialog-problem" role="alert" className={`${styles.warning} ${styles.wide}`}>{problem}</p>}
        <div className={`${styles.dialogActions} ${styles.wide}`}>
          <button type="button" onClick={onCancel} className="fitx-button fitx-button-secondary">Cancel</button>
          <button type="submit" aria-disabled={busy || !name.trim() || undefined} className="fitx-button">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Sheet>
  );
}
