"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import styles from "./content.module.css";

/**
 * A submit button for something that cannot be undone: the first press asks, the second sends. It
 * goes back to asking after 6 seconds or when focus leaves it.
 */
export function ConfirmSubmit({ label, confirmLabel, tone = "danger", small }: { label: string; confirmLabel: string; tone?: "danger" | "quiet"; small?: boolean }) {
  const { pending } = useFormStatus();
  const [asking, setAsking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (asking) confirmRef.current?.focus();
  }, [asking]);
  const className = `${tone === "danger" ? styles.buttonDanger : styles.buttonQuiet} ${small ? styles.small : ""}`;
  if (!asking) {
    return (
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          setAsking(true);
          timer.current = setTimeout(() => setAsking(false), 6000);
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <button type="submit" className={`${styles.buttonDanger} ${small ? styles.small : ""}`} disabled={pending} aria-live="polite" onBlur={() => !pending && setAsking(false)} ref={confirmRef}>
      {pending && <LoaderCircle aria-hidden="true" className="spin" size={15} />}
      {confirmLabel}
    </button>
  );
}

/** A plain submit button that switches off while its form is sending. */
export function SubmitButton({ children, quiet, small }: { children: React.ReactNode; quiet?: boolean; small?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`${quiet ? styles.buttonQuiet : styles.button} ${small ? styles.small : ""}`} disabled={pending} aria-disabled={pending}>
      {pending && <LoaderCircle aria-hidden="true" className="spin" size={15} />}
      {children}
    </button>
  );
}
