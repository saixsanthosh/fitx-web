"use client";

import styles from "./Explore.module.css";

/** An on/off switch with its label and one line of help. */
export function SwitchRow({ id, label, help, checked, onChange, disabled }: { id: string; label: string; help?: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <div className={styles.switchRow}>
      <div className="min-w-0">
        <p id={`${id}-label`} className={styles.label}>{label}</p>
        {help && <p id={`${id}-help`} className={styles.hint}>{help}</p>}
      </div>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={help ? `${id}-help` : undefined}
        disabled={disabled}
        className={styles.switch}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}
