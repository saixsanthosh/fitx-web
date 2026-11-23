"use client";

import { useId, useState, type CSSProperties } from "react";
import { Minus, Plus } from "lucide-react";
import { FieldError, UnitToggle } from "@/components/profile/ProfileControls";
import {
  HEIGHT_UNIT_OPTIONS,
  WEIGHT_UNIT_OPTIONS,
  cmToFeetInches,
  feetInchesToCm,
  kgToLb,
  lbToKg,
  parseDecimal,
  type HeightUnit,
  type WeightUnit,
} from "@/lib/domain/profile-options";
import { dialScale, type DialKind } from "@/lib/onboarding/dial";
import styles from "./MeasureDial.module.css";

type Props = {
  label: string;
  error?: string | null;
  optional?: boolean;
  /** False while the unit can't be saved (before the profile v2 migration). */
  showUnits?: boolean;
} & (
  | { kind: "height"; value: number | null; unit: HeightUnit; onChange: (cm: number | null) => void; onUnitChange: (unit: HeightUnit) => void }
  | { kind: "weight"; value: number | null; unit: WeightUnit; onChange: (kg: number | null) => void; onUnitChange: (unit: WeightUnit) => void }
);

/** The value in display units (inches for ft + in, pounds for lb), or null. */
function toDisplay(kind: DialKind, unit: string, value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (kind === "height") return unit === "ft_in" ? Math.round(value / 2.54) : Math.round(value);
  return unit === "lb" ? kgToLb(value) : Math.round(value * 10) / 10;
}

function fromDisplay(kind: DialKind, unit: string, value: number): number {
  if (kind === "height") return unit === "ft_in" ? feetInchesToCm(0, value) : value;
  return unit === "lb" ? lbToKg(value) : Math.round(value * 10) / 10;
}

/**
 * A height or weight as a dial: a large readout you can type into, a ruler slider for the thumb, and steppers
 * for fine tuning. Always reports centimetres or kilograms (null when empty, NaN when what is typed is not a
 * number), whatever unit is shown. The readout textbox carries the label, so forms and tests find it by name.
 */
export function MeasureDial(props: Props) {
  const { label, error, optional = false, showUnits = true, kind } = props;
  const id = useId();
  const unit: string = props.unit;
  const scale = dialScale(kind, unit);
  const shown = toDisplay(kind, unit, props.value);
  const [draft, setDraft] = useState<{ main: string; inches: string } | null>(null);
  const report = (value: number | null) => (props.onChange as (value: number | null) => void)(value);

  const imperialHeight = kind === "height" && unit === "ft_in";
  const parts = imperialHeight && shown !== null ? cmToFeetInches(props.value as number) : null;
  const text = draft ?? {
    main: shown === null ? "" : imperialHeight ? String(parts!.feet) : String(shown),
    inches: imperialHeight && parts ? String(parts.inches) : "",
  };

  function typed(next: { main: string; inches: string }) {
    setDraft(next);
    if (imperialHeight) {
      const feet = parseDecimal(next.main);
      const inches = parseDecimal(next.inches);
      if (feet === null && inches === null) return report(null);
      if (Number.isNaN(feet) || Number.isNaN(inches)) return report(Number.NaN);
      return report(feetInchesToCm(feet ?? 0, inches ?? 0));
    }
    const parsed = parseDecimal(next.main);
    report(parsed === null || Number.isNaN(parsed) ? parsed : fromDisplay(kind, unit, parsed));
  }

  function slide(display: number) {
    setDraft(null);
    report(fromDisplay(kind, unit, display));
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
          ? <UnitToggle label={`${label} unit`} options={HEIGHT_UNIT_OPTIONS} value={props.unit} onChange={(next) => { setDraft(null); props.onUnitChange(next); }} />
          : <UnitToggle label={`${label} unit`} options={WEIGHT_UNIT_OPTIONS} value={props.unit} onChange={(next) => { setDraft(null); props.onUnitChange(next); }} />)}
      </div>

      <div className={styles.readout}>
        <button type="button" className={styles.step} aria-label={`Less ${label.toLowerCase()}`} onClick={() => slide(Math.max(scale.min, position - scale.step))}><Minus size={18} aria-hidden="true" /></button>
        <div className={styles.numbers}>
          <span className={styles.field}>
            <input id={id} className={styles.input} inputMode="decimal" placeholder="–" value={text.main} aria-invalid={invalid} aria-describedby={describedBy}
              aria-label={imperialHeight ? `${label} in feet` : undefined} size={imperialHeight ? 1 : 4}
              onChange={(event) => typed({ ...text, main: event.target.value })} onBlur={() => setDraft(null)} />
            <span className={styles.unit} aria-hidden="true">{unitLabel}</span>
          </span>
          {imperialHeight && (
            <span className={styles.field}>
              <input className={styles.input} inputMode="decimal" placeholder="–" value={text.inches} aria-label={`${label}, extra inches`} aria-invalid={invalid} aria-describedby={describedBy} size={2}
                onChange={(event) => typed({ ...text, inches: event.target.value })} onBlur={() => setDraft(null)} />
              <span className={styles.unit} aria-hidden="true">in</span>
            </span>
          )}
        </div>
        <button type="button" className={styles.step} aria-label={`More ${label.toLowerCase()}`} onClick={() => slide(Math.min(scale.max, position + scale.step))}><Plus size={18} aria-hidden="true" /></button>
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
