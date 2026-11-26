"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { resultText } from "@/components/form-rules";
import type { FormState } from "@/lib/content/form";
import styles from "./content.module.css";

/**
 * The sticky save bar of a content form: the submit button (off while saving, so nothing is sent twice; it
 * stays focusable, aria-disabled, since a disabled button drops keyboard focus to the page) and the result,
 * announced to screen readers (empty while saving, so a second "Saved." or the same refusal is read out again).
 * After an error, focus moves to the first invalid field.
 */
export function FormFooter({ state, pending, label, pendingLabel = "Saving", formRef, children }: {
  state: FormState;
  pending: boolean;
  label: string;
  pendingLabel?: string;
  formRef?: React.RefObject<HTMLFormElement | null>;
  children?: React.ReactNode;
}) {
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status !== "error") return;
    const invalid = formRef?.current?.querySelector<HTMLElement>("[aria-invalid='true']");
    (invalid ?? statusRef.current)?.focus();
  }, [state, formRef]);
  return (
    <div className={styles.formFoot}>
      <button className={styles.button} type="submit" aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault(); }}>
        {pending && <LoaderCircle aria-hidden="true" className="spin" size={16} />}
        {pending ? pendingLabel : label}
      </button>
      {children}
      <p className={styles.formStatus} ref={statusRef} tabIndex={-1} role="status" aria-live="polite">
        {resultText(state, pending, { saved: "Saved.", error: "Check the fields marked in red." })}
      </p>
    </div>
  );
}
