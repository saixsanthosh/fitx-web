"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import styles from "./FoodUi.module.css";

/** Asks for a name, for saving a meal or a day's routine. */
export function NameDialog({ title, description, initial, busy, onCancel, onSave }: {
  title: string;
  description: string;
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.select();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="name-dialog-title">
        <div className={styles.dialogHeader}>
          <div>
            <h2 id="name-dialog-title">{title}</h2>
            <p className={styles.muted}>{description}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" className={styles.iconButton}><X size={16}/></button>
        </div>
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
          <label className={styles.wide}>Name<input ref={input} className="fitx-field" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)}/></label>
          <div className={`${styles.dialogActions} ${styles.wide}`}>
            <button type="button" onClick={onCancel} className="fitx-button fitx-button-secondary">Cancel</button>
            <button type="submit" disabled={busy || !name.trim()} className="fitx-button">{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
