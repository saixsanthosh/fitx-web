"use client";

import { useId } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import { FieldError } from "@/components/profile/ProfileControls";
import type { SiteImage } from "@/data/onboarding-media";
import styles from "./PhotoChoices.module.css";

export type PhotoOption<V extends string> = { value: V; label: string; hint?: string; photo: SiteImage; disabledHint?: string };

/**
 * One answer as photo cards: native radios (one Tab stop, arrow keys move the choice) in a fieldset with a
 * legend, so screen readers and the e2e `choose()` helper see a normal group. The chosen card lifts and its
 * photo eases in; the label sits on a dark wash at the foot of the card, readable in every theme.
 */
export function PhotoChoices<V extends string>({
  legend,
  options,
  value,
  onChange,
  error,
  disabledValues = [],
  layout = "goals",
}: {
  legend: string;
  options: readonly PhotoOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  error?: string | null;
  disabledValues?: readonly V[];
  layout?: "goals" | "three";
}) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined} className="min-w-0">
      <legend className={styles.legend}>{legend}</legend>
      <div className={`${styles.grid} ${layout === "three" ? styles.three : styles.goals}`}>
        {options.map((option, index) => {
          const disabled = disabledValues.includes(option.value);
          return (
            <label key={option.value} className={styles.card} data-disabled={disabled ? "" : undefined}>
              <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} className="sr-only" />
              <span className={styles.photo} aria-hidden="true">
                <Image src={option.photo.src} alt="" fill sizes="(min-width: 1024px) 220px, (min-width: 640px) 30vw, 46vw" placeholder="blur" blurDataURL={option.photo.blurDataURL} priority={index < 2} />
              </span>
              <span className={styles.wash} aria-hidden="true" />
              <span className={styles.text}>
                <span className={styles.name}>{option.label}</span>
                {option.hint && <span className={styles.hint}>{option.hint}</span>}
                {disabled && option.disabledHint && <span className={styles.hint}>{option.disabledHint}</span>}
              </span>
              <span className={styles.tick} aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
            </label>
          );
        })}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}
