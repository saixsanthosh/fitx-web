// Labelled form controls for the content editors: each has a visible label, an optional one-line hint
// and an error that is announced and tied to the control with aria-describedby.
import styles from "./content.module.css";

type Base = { name: string; label: string; hint?: string; error?: string; id?: string };

function describedBy(id: string, hint?: string, error?: string) {
  return [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
}

function Extras({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {hint && <p className={styles.hint} id={`${id}-hint`}>{hint}</p>}
      {error && <p className={styles.error} id={`${id}-error`} role="alert">{error}</p>}
    </>
  );
}

export function TextField({ name, label, hint, error, id = `f-${name}`, defaultValue, required, maxLength, placeholder, autoComplete = "off", inputMode, suffix }: Base & {
  defaultValue?: string | number | null;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "decimal";
  suffix?: string;
}) {
  const input = (
    <input
      className={styles.input}
      id={id}
      name={name}
      defaultValue={defaultValue ?? ""}
      required={required}
      maxLength={maxLength}
      placeholder={placeholder}
      autoComplete={autoComplete}
      inputMode={inputMode}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, hint, error)}
    />
  );
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      {suffix ? <div className={styles.suffix}>{input}<span aria-hidden="true">{suffix}</span></div> : input}
      <Extras id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextAreaField({ name, label, hint, error, id = `f-${name}`, defaultValue, rows = 5, maxLength }: Base & { defaultValue?: string; rows?: number; maxLength?: number }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <textarea
        className={styles.textarea}
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ""}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
      />
      <Extras id={id} hint={hint} error={error} />
    </div>
  );
}

export function SelectField({ name, label, hint, error, id = `f-${name}`, defaultValue, options, empty }: Base & {
  defaultValue?: string | null;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** A first option for "none". */
  empty?: string;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <select className={styles.select} id={id} name={name} defaultValue={defaultValue ?? ""} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <Extras id={id} hint={hint} error={error} />
    </div>
  );
}

/** Chips that are checkboxes (multiple) or radios (one), in a fieldset with a legend. */
export function ChoiceField({ name, label, hint, error, id = `f-${name}`, options, selected, multiple = true }: Base & {
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: readonly string[];
  multiple?: boolean;
}) {
  return (
    <fieldset className={styles.field} aria-describedby={describedBy(id, hint, error)}>
      <legend className={styles.label}>{label}</legend>
      <div className={styles.choices}>
        {options.map((option) => (
          <label key={option.value} className={styles.choice}>
            <input type={multiple ? "checkbox" : "radio"} name={name} value={option.value} defaultChecked={selected.includes(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <Extras id={id} hint={hint} error={error} />
    </fieldset>
  );
}

export function ToggleField({ name, label, defaultChecked, hint, id = `f-${name}` }: { name: string; label: string; defaultChecked?: boolean; hint?: string; id?: string }) {
  return (
    <div className={styles.field}>
      <label className={styles.toggle} htmlFor={id}>
        <input type="checkbox" id={id} name={name} defaultChecked={defaultChecked} aria-describedby={hint ? `${id}-hint` : undefined} />
        {label}
      </label>
      {hint && <p className={styles.hint} id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}
