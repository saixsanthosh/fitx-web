"use client";

import Link from "next/link";
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  ageFromBirthDate,
  birthDateBounds,
  cmToFeetInches,
  feetInchesToCm,
  HEIGHT_UNIT_OPTIONS,
  kgToLb,
  lbToKg,
  MAX_CUSTOM_ENTRIES,
  MAX_CUSTOM_LENGTH,
  commitDraft,
  parseDecimal,
  WEIGHT_UNIT_OPTIONS,
  type HeightUnit,
  type Option,
  type WeightUnit,
} from "@/lib/domain/profile-options";

/**
 * Form controls shared by onboarding and Profile. Choices are native radio and checkbox inputs (so the
 * keyboard, screen readers and form semantics work as usual) styled as cards and chips; every target is
 * at least 44 px tall; colours come from the theme tokens only.
 */

const focusRing = "has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fitx-primary";
/** .fitx-field sets its border outside Tailwind's layers, so the error colour needs !important. */
const invalidBorder = "aria-invalid:border-fitx-danger!";

/** Moves focus (and the view) to the first answer marked invalid in `root`, after React has rendered it. */
export function focusFirstInvalid(root: HTMLElement | null) {
  requestAnimationFrame(() => {
    const invalid = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const target = invalid?.tagName === "FIELDSET" ? invalid.querySelector<HTMLElement>("input:not([disabled])") : invalid;
    target?.focus({ preventScroll: true });
    (invalid ?? target)?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function Legend({ legend, hint, hintId }: { legend: ReactNode; hint?: ReactNode; hintId: string }) {
  return (
    <>
      <legend className="text-sm font-semibold text-fitx-text">{legend}</legend>
      {hint && <p id={hintId} className="mt-1 text-xs leading-5 text-fitx-text-secondary">{hint}</p>}
    </>
  );
}

/** One answer from a list, shown as cards (with hints) or compact tiles. */
export function ChoiceGroup<V extends string | number>({
  legend,
  hint,
  options,
  value,
  onChange,
  columns = "grid-cols-1 sm:grid-cols-2",
  showHints = true,
  disabledValues = [],
  error,
  compact = false,
  onClear,
  clearLabel = "Clear",
}: {
  legend: ReactNode;
  hint?: ReactNode;
  options: readonly { value: V; label: string; hint?: string }[];
  value: V | null;
  onChange: (value: V) => void;
  columns?: string;
  showHints?: boolean;
  disabledValues?: readonly V[];
  error?: string | null;
  /** Short answers (numbers, "45 min") as centred tiles without the radio dot. */
  compact?: boolean;
  /** Offers a way back to "not answered" (shown while something is chosen). */
  onClear?: () => void;
  clearLabel?: string;
}) {
  const name = useId();
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
      <Legend legend={legend} hint={hint} hintId={hintId} />
      {onClear && value !== null && (
        <button type="button" onClick={onClear} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-fitx-primary-text underline-offset-4 hover:underline">
          {clearLabel}
        </button>
      )}
      <div className={`${onClear && value !== null ? "mt-1" : "mt-3"} grid gap-2 ${columns}`}>
        {options.map((option) => {
          const disabled = disabledValues.includes(option.value);
          return (
            <label
              key={String(option.value)}
              className={`group relative flex min-h-12 cursor-pointer select-none items-center rounded-xl border border-fitx-border bg-fitx-surface text-sm transition-colors hover:border-fitx-text-disabled has-checked:border-fitx-primary has-checked:bg-fitx-primary/[.07] has-disabled:cursor-not-allowed has-disabled:opacity-55 ${compact ? "justify-center px-2 py-2 text-center" : "gap-3 px-3.5 py-2.5 text-left"} ${focusRing}`}
            >
              <input
                type="radio"
                name={name}
                value={String(option.value)}
                checked={value === option.value}
                disabled={disabled}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {!compact && (
                <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-fitx-border bg-fitx-surface group-has-checked:border-fitx-primary group-has-checked:bg-fitx-primary">
                  <Check size={12} strokeWidth={3} className="hidden text-fitx-on-primary group-has-checked:block" />
                </span>
              )}
              <span className="min-w-0">
                <span className={`block font-medium text-fitx-text ${compact ? "whitespace-nowrap group-has-checked:font-semibold" : ""}`}>{option.label}</span>
                {showHints && option.hint && <span className="mt-0.5 block text-xs leading-5 text-fitx-text-secondary">{option.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

/** Any number of answers from a list, shown as chips. */
export function ChipGroup<V extends string>({
  legend,
  hint,
  options,
  values,
  onChange,
  locked = [],
}: {
  legend: ReactNode;
  hint?: ReactNode;
  options: readonly Option<V>[];
  values: readonly string[];
  onChange: (values: V[]) => void;
  /** Always selected (for example bodyweight in equipment). */
  locked?: readonly V[];
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const toggle = (value: V) => {
    const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
    // Keep the list's own order, so saved values are stable.
    onChange(options.map((option) => option.value).filter((key) => next.includes(key) || locked.includes(key)));
  };
  return (
    <fieldset aria-describedby={hint ? hintId : undefined}>
      <Legend legend={legend} hint={hint} hintId={hintId} />
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => {
          const isLocked = locked.includes(option.value);
          return (
            <label
              key={option.value}
              title={option.hint}
              className={`group inline-flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-full border border-fitx-border bg-fitx-surface px-4 text-sm text-fitx-text-secondary transition-colors hover:text-fitx-text has-checked:border-fitx-primary has-checked:bg-fitx-primary/10 has-checked:text-fitx-text has-disabled:cursor-default ${focusRing}`}
            >
              <input
                type="checkbox"
                checked={isLocked || values.includes(option.value)}
                disabled={isLocked}
                onChange={() => toggle(option.value)}
                className="sr-only"
              />
              <Check size={14} strokeWidth={2.5} aria-hidden="true" className="hidden text-fitx-primary group-has-checked:block" />
              <span>{option.label}</span>
              {option.hint && <span className="sr-only">: {option.hint}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The user's own entries ("Kiwi", "Bitter gourd"), added with Enter, a comma or the + button. The text
 * still in the box is the parent's (`draft`), and the parent saves it with the entries (commitDraft), so
 * typing an allergy and tapping Save or Continue never drops it. (Turning it into a chip on blur moved the
 * Save button mid-tap, so that tap missed.)
 */
export function TagInput({
  legend,
  hint,
  values,
  onChange,
  placeholder,
  addLabel,
  max = MAX_CUSTOM_ENTRIES,
  maxLength = MAX_CUSTOM_LENGTH,
  draft,
  onDraftChange,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  addLabel: string;
  max?: number;
  maxLength?: number;
  /** Text typed but not yet added; the parent includes it when saving. */
  draft: string;
  onDraftChange: (value: string) => void;
}) {
  const id = useId();
  const setDraft = onDraftChange;
  const full = values.length >= max;
  const add = () => {
    onChange(commitDraft(values, draft, { max, maxLength }));
    setDraft("");
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (draft.trim()) add();
    }
  };
  return (
    <fieldset aria-describedby={hint ? `${id}-hint` : undefined}>
      <Legend legend={legend} hint={hint} hintId={`${id}-hint`} />
      <div className="mt-3 flex gap-2">
        <input
          id={`${id}-input`}
          className="fitx-field"
          value={draft}
          maxLength={maxLength}
          disabled={full}
          placeholder={full ? `Up to ${max} entries` : placeholder}
          aria-label={addLabel}
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
        />
        <button type="button" onClick={add} disabled={!draft.trim() || full} aria-label={addLabel} className="fitx-button fitx-button-secondary min-w-12 shrink-0 px-3">
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
      {values.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label={typeof legend === "string" ? legend : undefined}>
          {values.map((value) => (
            <li key={value} className="inline-flex min-h-11 items-center rounded-full border border-fitx-border bg-fitx-surface-variant pl-4 text-sm text-fitx-text">
              <span className="max-w-[16rem] truncate">{value}</span>
              <button
                type="button"
                onClick={() => onChange(values.filter((item) => item !== value))}
                aria-label={`Remove ${value}`}
                className="grid min-h-11 min-w-11 place-items-center rounded-full text-fitx-text-secondary hover:text-fitx-text"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** A two-way unit switch (cm | ft + in, kg | lb) that sits next to its field. */
export function UnitToggle<V extends string>({ label, options, value, onChange }: { label: string; options: readonly Option<V>[]; value: V; onChange: (value: V) => void }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg border border-fitx-border bg-fitx-surface-variant p-0.5">
      {options.map((option) => (
        <label
          key={option.value}
          className={`inline-flex min-h-11 min-w-11 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-md px-2.5 text-xs font-semibold text-fitx-text-secondary transition-colors has-checked:bg-fitx-surface has-checked:text-fitx-text has-checked:shadow-sm ${focusRing}`}
        >
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />
          {option.label}
        </label>
      ))}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return <p id={id} className="mt-1.5 text-xs font-medium text-fitx-danger">{message}</p>;
}

/** A labelled text or number input with an optional error. */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  inputMode,
  autoComplete,
  maxLength,
  placeholder,
  suffix,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
  type?: "text" | "email";
  inputMode?: "text" | "decimal" | "numeric";
  autoComplete?: string;
  maxLength?: number;
  placeholder?: string;
  suffix?: string;
  required?: boolean;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-fitx-text">{label}{!required && <span className="font-normal text-fitx-text-secondary"> (optional)</span>}</label>
      {hint && <p id={`${id}-hint`} className="mt-0.5 text-xs text-fitx-text-secondary">{hint}</p>}
      <div className="relative mt-1.5">
        <input
          id={id}
          className={`fitx-field ${suffix ? "pr-12" : ""} ${invalidBorder}`}
          type={type}
          value={value}
          inputMode={inputMode}
          autoComplete={autoComplete}
          maxLength={maxLength}
          placeholder={placeholder}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-fitx-text-secondary">{suffix}</span>}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

const heightText = (cm: number | null, unit: HeightUnit) => {
  if (cm === null || !Number.isFinite(cm)) return { cm: "", feet: "", inches: "" };
  const { feet, inches } = cmToFeetInches(cm);
  return { cm: unit === "cm" ? String(Math.round(cm * 10) / 10) : "", feet: String(feet), inches: String(inches) };
};

/**
 * Height in centimetres or feet and inches; always reports centimetres (null when empty, NaN when the
 * text is not a number).
 */
export function HeightField({
  label = "Height",
  cm,
  unit,
  onChange,
  onUnitChange,
  error,
  required,
  showUnits = true,
}: {
  label?: string;
  cm: number | null;
  unit: HeightUnit;
  onChange: (cm: number | null) => void;
  onUnitChange: (unit: HeightUnit) => void;
  error?: string | null;
  required?: boolean;
  /** False while the unit can't be saved (before the profile v2 migration): the field stays in cm. */
  showUnits?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(() => heightText(cm, unit));
  const [textUnit, setTextUnit] = useState(unit);
  if (textUnit !== unit) {
    setTextUnit(unit);
    setText(heightText(cm, unit));
  }
  const report = (next: typeof text, currentUnit: HeightUnit) => {
    setText(next);
    if (currentUnit === "cm") return onChange(parseDecimal(next.cm));
    const feet = parseDecimal(next.feet);
    const inches = parseDecimal(next.inches);
    if (feet === null && inches === null) return onChange(null);
    if (Number.isNaN(feet) || Number.isNaN(inches)) return onChange(Number.NaN);
    onChange(feetInchesToCm(feet ?? 0, inches ?? 0));
  };
  const switchUnit = (next: HeightUnit) => {
    onUnitChange(next);
    setTextUnit(next);
    setText(heightText(cm, next));
  };
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={unit === "cm" ? id : `${id}-ft`} className="block text-sm font-medium text-fitx-text">{label}{!required && <span className="font-normal text-fitx-text-secondary"> (optional)</span>}</label>
      <div className="mt-1.5 flex items-center gap-2">
        {unit === "cm" ? (
          <div className="relative min-w-0 flex-1">
            <input id={id} className={`fitx-field pr-12 ${invalidBorder}`} inputMode="decimal" value={text.cm} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => report({ ...text, cm: event.target.value }, "cm")} />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-fitx-text-secondary">cm</span>
          </div>
        ) : (
          <>
            <div className="relative min-w-0 flex-1">
              <input id={`${id}-ft`} className={`fitx-field pr-10 ${invalidBorder}`} inputMode="numeric" value={text.feet} aria-label={`${label} in feet`} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => report({ ...text, feet: event.target.value }, "ft_in")} />
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fitx-text-secondary">ft</span>
            </div>
            <div className="relative min-w-0 flex-1">
              <input className={`fitx-field pr-10 ${invalidBorder}`} inputMode="decimal" value={text.inches} aria-label={`${label}, extra inches`} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => report({ ...text, inches: event.target.value }, "ft_in")} />
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fitx-text-secondary">in</span>
            </div>
          </>
        )}
        {showUnits && <UnitToggle label={`${label} unit`} options={HEIGHT_UNIT_OPTIONS} value={unit} onChange={switchUnit} />}
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/** Weight in kilograms or pounds; always reports kilograms (null when empty, NaN when not a number). */
export function WeightField({
  label,
  kg,
  unit,
  onChange,
  onUnitChange,
  error,
  hint,
  required,
  showUnits = true,
}: {
  label: string;
  kg: number | null;
  unit: WeightUnit;
  onChange: (kg: number | null) => void;
  onUnitChange: (unit: WeightUnit) => void;
  error?: string | null;
  hint?: string;
  required?: boolean;
  /** False while the unit can't be saved (before the profile v2 migration): the field stays in kg. */
  showUnits?: boolean;
}) {
  const id = useId();
  const shown = (value: number | null, inUnit: WeightUnit) => (value === null || !Number.isFinite(value) ? "" : String(inUnit === "lb" ? kgToLb(value) : Math.round(value * 10) / 10));
  const [text, setText] = useState(() => shown(kg, unit));
  // Two weight fields share one unit: when the other field switches it, show this value in the new unit too.
  const [textUnit, setTextUnit] = useState(unit);
  if (textUnit !== unit) {
    setTextUnit(unit);
    setText(shown(kg, unit));
  }
  const report = (value: string, inUnit: WeightUnit) => {
    setText(value);
    const parsed = parseDecimal(value);
    onChange(parsed === null || Number.isNaN(parsed) ? parsed : inUnit === "lb" ? lbToKg(parsed) : parsed);
  };
  const switchUnit = (next: WeightUnit) => {
    onUnitChange(next);
    setTextUnit(next);
    setText(shown(kg, next));
  };
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-fitx-text">{label}{!required && <span className="font-normal text-fitx-text-secondary"> (optional)</span>}</label>
      {hint && <p id={`${id}-hint`} className="mt-0.5 text-xs text-fitx-text-secondary">{hint}</p>}
      <div className="mt-1.5 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input id={id} className={`fitx-field pr-12 ${invalidBorder}`} inputMode="decimal" value={text} aria-invalid={error ? true : undefined} aria-describedby={describedBy} onChange={(event) => report(event.target.value, unit)} />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-fitx-text-secondary">{unit}</span>
        </div>
        {showUnits && <UnitToggle label={`${label} unit`} options={WEIGHT_UNIT_OPTIONS} value={unit} onChange={switchUnit} />}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/**
 * A date of birth in the browser's date picker, limited to ages 13 to 100 (AGE_RANGE), with the age it gives
 * beside it. Reports YYYY-MM-DD, or "" while empty.
 */
/**
 * A saved date of birth, read-only. Members add it once; changing it is a FITX support request, because it decides
 * which parts of Explore are open (the database refuses a member's change, 20261124100000).
 */
export function SavedBirthDate({ value, helpHref = "/help" }: { value: string; helpHref?: string }) {
  const id = useId();
  const age = ageFromBirthDate(value);
  const text = new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-note`}>
      <p id={`${id}-label`} className="text-sm font-medium text-fitx-text">Date of birth</p>
      <p className="mt-1.5 text-sm text-fitx-text">
        {text}
        {age !== null && <span className="ml-1.5 text-fitx-text-secondary">· {age} years</span>}
      </p>
      <p id={`${id}-note`} className="mt-1.5 text-xs leading-5 text-fitx-text-secondary">You can add it once. To change it, ask FITX support.</p>
      {/* The colour sits on the inner span: the global unlayered `a { color: inherit }` outranks utilities on the link. */}
      <Link href={helpHref} className="group inline-flex min-h-11 items-center text-sm font-medium">
        <span className="text-fitx-primary-text underline-offset-4 group-hover:underline">Ask FITX support</span>
      </Link>
    </div>
  );
}

export function BirthDateField({ label = "Date of birth", value, onChange, error, required = true }: { label?: string; value: string; onChange: (value: string) => void; error?: string | null; required?: boolean }) {
  const id = useId();
  const bounds = useMemo(() => birthDateBounds(), []);
  const age = ageFromBirthDate(value);
  const describedBy = [`${id}-age`, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-fitx-text">{label}{!required && <span className="font-normal text-fitx-text-secondary"> (optional)</span>}</label>
      <div className="mt-1.5 flex items-center gap-3">
        <input
          id={id}
          type="date"
          className={`fitx-field max-w-[15rem] ${invalidBorder}`}
          value={value}
          min={bounds.min}
          max={bounds.max}
          autoComplete="bday"
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        <span id={`${id}-age`} className="text-sm text-fitx-text-secondary" aria-live="polite">{age !== null && age <= 130 ? `${age} years` : ""}</span>
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
