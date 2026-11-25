"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";

/**
 * A submit button that switches itself off while its form's Server Action runs, so a double click or a
 * second tap cannot send the same thing twice. It stays focusable (aria-disabled, and a press while busy
 * sends nothing): a disabled button drops keyboard focus to the page in Chrome.
 */
export function PendingButton({ className, children, pendingLabel }: { className: string; children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault(); }}>
      {pending && <LoaderCircle aria-hidden="true" className="spin" size={16} />}
      <span>{pending ? pendingLabel : children}</span>
    </button>
  );
}
