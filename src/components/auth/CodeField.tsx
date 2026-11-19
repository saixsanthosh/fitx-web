"use client";

import { forwardRef, useId, useState } from "react";
import { CODE_LENGTH, isCompleteCode, normaliseCode } from "@/lib/auth/email-code";
import s from "./auth.module.css";

type Props = {
  value: string;
  onChange: (code: string) => void;
  /** Called once all six digits are in, typed or pasted. */
  onComplete?: (code: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
};

/**
 * The 6-digit code: one real input (so paste, autofill from the e-mail on phones, screen readers and
 * password managers all work) drawn as six boxes. Pasting "123 456" or a whole sentence keeps the digits.
 */
export const CodeField = forwardRef<HTMLInputElement, Props>(function CodeField(
  { value, onChange, onComplete, invalid = false, disabled = false, describedBy },
  ref,
) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <div className={s.field}>
      <label htmlFor={id}>6-digit code</label>
      <div className={s.codeBox} data-invalid={invalid} data-focused={focused}>
        {Array.from({ length: CODE_LENGTH }, (_, index) => (
          <span key={index} className={s.codeCell} data-active={focused && index === active} aria-hidden="true">
            {value[index] ?? (focused && index === active ? <span className={s.caret} /> : "")}
          </span>
        ))}
        <input
          ref={ref}
          id={id}
          className={s.codeInput}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          spellCheck={false}
          required
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={value}
          onFocus={(event) => {
            setFocused(true);
            const end = event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(end, end);
          }}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            const code = normaliseCode(event.target.value);
            onChange(code);
            if (isCompleteCode(code) && code !== value) onComplete?.(code);
          }}
        />
      </div>
    </div>
  );
});
