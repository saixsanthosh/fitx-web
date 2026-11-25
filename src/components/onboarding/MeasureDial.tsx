"use client";

import { useId, useRef, type CSSProperties, type FocusEvent } from "react";
import { Minus, Plus } from "lucide-react";
import { FieldError, UnitToggle } from "@/components/profile/ProfileControls";
import { HEIGHT_UNIT_OPTIONS, WEIGHT_UNIT_OPTIONS, cmToFeetInches, type HeightUnit, type WeightUnit } from "@/lib/domain/profile-options";
import { dialScale, dialStep } from "@/lib/onboarding/dial";
import { keptDraft, measureFromShown, measureRead, measureShown, measureSwitch, measureText, type MeasureText } from "@/lib/onboarding/measure-field";
import styles from "./MeasureDial.module.css";

type Props = {
  label: string;
  error?: string | null;
  optional?: boolean;
  /** False while the unit can't be saved (before the profile v2 migration). */
  showUnits?: boolean;
  /**
   * The text shown in place of the value: what is being typed, then text kept because it is not a number (null: the
   * value's own text shows). The parent holds it, so it outlives the dial: setup's pages unmount their fields on Back,
   * and a field holding NaN must come back showing the text that gave it, never an empty box.
   */
  draft: MeasureText | null;
  onDraftChange: (draft: MeasureText | null) => void;
  /** Called when the member leaves the typed value (not when moving between the feet and inches boxes). */
  onCommit?: () => void;
} & (
  // onUnitChange: a unit chosen with the toggle or typed after the number, and what the field holds in it.
  | { kind: "height"; value: number | null; unit: HeightUnit; onChange: (cm: number | null) => void; onUnitChange: (unit: HeightUnit, cm: number | null) => void }
  | { kind: "weight"; value: number | null; unit: WeightUnit; onChange: (kg: number | null) => void; onUnitChange: (unit: WeightUnit, kg: number | null) => void }
);

/**
 * A height or weight as a dial: a large readout you can type into, a ruler slider for the thumb, and steppers
 * for fine tuning. Always reports centimetres or kilograms (null when empty, NaN when what is typed is not a
 * number), whatever unit is shown. The readout textbox carries the label, so forms and tests find it by name.
 * It shows the stored value in the unit shown to 0.1, exactly as typed (175.5 cm stays 175.5, 150 lb stays 150),
 * and the steppers move from that value by one whole step. A unit typed after the number is understood ("65kg";
 * "150 lb" in kilograms switches the unit to lb), and text that is not a number stays as typed when the member
 * moves on, so the field never looks empty while it holds something that can't be saved (measure-field.ts). That
 * text is the parent's `draft`, so it is still there when the dial is mounted again.
 */
export function MeasureDial(props: Props) {
  const { label, error, optional = false, showUnits = true, kind, draft, onDraftChange, onCommit } = props;
  const id = useId();
  const unit: string = props.unit;
  const scale = dialScale(kind, unit);
  const shown = measureShown(kind, unit, props.value);
  const numbers = useRef<HTMLDivElement>(null);
  const report = (value: number | null) => (props.onChange as (value: number | null) => void)(value);
  const changeUnit = (next: HeightUnit | WeightUnit, value: number | null) => (props.onUnitChange as (unit: HeightUnit | WeightUnit, value: number | null) => void)(next, value);

  const imperialHeight = kind === "height" && unit === "ft_in";
  const parts = imperialHeight && shown !== null ? cmToFeetInches(props.value as number) : null;
  const text = draft ?? measureText(kind, unit, props.value);

  function typed(next: MeasureText) {
    onDraftChange(next);
    const read = measureRead(kind, unit, next, showUnits);
    if (read.unit !== unit) changeUnit(read.unit, read.value);
    report(read.value);
  }

  /** The slider and the steppers give a value in the unit shown. */
  function slide(display: number) {
    onDraftChange(null);
    report(measureFromShown(kind, unit, display));
  }

  function leave(event: FocusEvent<HTMLInputElement>) {
    // Moving between the feet and inches boxes is still the same answer.
    if (event.relatedTarget instanceof Node && numbers.current?.contains(event.relatedTarget)) return;
    onDraftChange(keptDraft(kind, unit, draft));
    onCommit?.();
  }

  function switchUnit(next: HeightUnit | WeightUnit) {
    // Kept text is read again in the new unit (the feet box becomes the centimetre box). The value goes with the unit,
    // not through onChange, which would clear the field's message as a typed change does: a message already shown is
    // said again for what the field holds, in the new unit.
    const switched = measureSwitch(kind, next, draft, props.value);
    if (switched.draft !== draft) onDraftChange(switched.draft);
    changeUnit(next, switched.value);
  }

  const position = shown === null ? scale.start : Math.min(scale.max, Math.max(scale.min, shown));
  const fill = ((position - scale.min) / (scale.max - scale.min)) * 100;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : undefined;
  const invalid = error ? true : undefined;
  const unitLabel = kind === "height" ? (imperialHeight ? "ft" : "cm") : unit;

  return (
    <div className={styles.dial} data-empty={shown === null ? "" : undefined}>
      <div className={styles.head}>
        <label htmlFor={id} className={styles.label}>{label}{optional && <span className={styles.optional}> (optional)</span>}</label>
        {showUnits && (kind === "height"
          ? <UnitToggle label={`${label} unit`} options={HEIGHT_UNIT_OPTIONS} value={props.unit} onChange={switchUnit} />
          : <UnitToggle label={`${label} unit`} options={WEIGHT_UNIT_OPTIONS} value={props.unit} onChange={switchUnit} />)}
      </div>

      <div className={styles.readout}>
        <button type="button" className={styles.step} aria-label={`Less ${label.toLowerCase()}`} onClick={() => slide(dialStep(kind, unit, shown, -1))}><Minus size={18} aria-hidden="true" /></button>
        <div ref={numbers} className={styles.numbers}>
          <span className={styles.field}>
            <input id={id} className={styles.input} inputMode="decimal" placeholder="–" value={text.main} aria-invalid={invalid} aria-describedby={describedBy}
              aria-label={imperialHeight ? `${label} in feet` : undefined} size={imperialHeight ? 1 : 4}
              onChange={(event) => typed({ ...text, main: event.target.value })} onBlur={leave} />
            <span className={styles.unit} aria-hidden="true">{unitLabel}</span>
          </span>
          {imperialHeight && (
            <span className={styles.field}>
              <input className={styles.input} inputMode="decimal" placeholder="–" value={text.inches} aria-label={`${label}, extra inches`} aria-invalid={invalid} aria-describedby={describedBy} size={2}
                onChange={(event) => typed({ ...text, inches: event.target.value })} onBlur={leave} />
              <span className={styles.unit} aria-hidden="true">in</span>
            </span>
          )}
        </div>
        <button type="button" className={styles.step} aria-label={`More ${label.toLowerCase()}`} onClick={() => slide(dialStep(kind, unit, shown, 1))}><Plus size={18} aria-hidden="true" /></button>
      </div>

      <input
        type="range"
        className={styles.ruler}
        min={scale.min}
        max={scale.max}
        step={scale.step}
        value={position}
        aria-label={`${label} dial`}
        aria-valuetext={shown === null ? "Not set" : imperialHeight && parts ? `${parts.feet} ft ${parts.inches} in` : `${shown} ${unitLabel}`}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(event) => slide(Number(event.target.value))}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}
