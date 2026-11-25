"use client";

import styles from "./Explore.module.css";

/**
 * An on/off switch with its label and one line of help. `busy` (a change on its way) is aria-disabled, not disabled,
 * so the switch keeps keyboard focus while it saves (D5); `disabled` is for a switch that cannot be used at all.
 */
export function SwitchRow({ id, label, help, checked, onChange, disabled, busy = false }: { id: string; label: string; help?: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; busy?: boolean }) {
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
        aria-disabled={busy || undefined}
        className={styles.switch}
        onClick={() => { if (!busy) onChange(!checked); }}
      />
    </div>
  );
}
