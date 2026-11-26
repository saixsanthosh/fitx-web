"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { LoaderCircle } from "lucide-react";
import { resultText } from "@/components/form-rules";
import type { FormState } from "@/lib/content/form";

/**
 * A submit button for a form that saves through useActionState. It stays focusable while the form saves (a disabled
 * button drops keyboard focus to the page in Chrome): it is aria-disabled, and a press while busy sends nothing.
 */
export function BusyButton({ pending, className, pendingLabel, children }: { pending: boolean; className: string; pendingLabel: string; children: ReactNode }) {
  return (
    <button className={className} type="submit" aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault(); }}>
      {pending && <LoaderCircle aria-hidden="true" className="spin" size={16} />}
      <span>{pending ? pendingLabel : children}</span>
    </button>
  );
}

/**
 * The result of a save, beside the button that was pressed, read out when it comes: the line is empty while a save is
 * on its way, so a result the same as the last one is read out again. After a refusal, focus moves to the field it is
 * about (which points back here with aria-describedby), or here.
 */
export function FormResult({ id, state, pending, formRef }: { id: string; state: FormState; pending: boolean; formRef: RefObject<HTMLFormElement | null> }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status !== "error") return;
    const invalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
    (invalid ?? ref.current)?.focus();
  }, [state, formRef]);
  return (
    <p id={id} ref={ref} tabIndex={-1} role="status" aria-live="polite" className={state.status === "error" ? "form-error" : "form-saved"}>
      {resultText(state, pending)}
    </p>
  );
}
