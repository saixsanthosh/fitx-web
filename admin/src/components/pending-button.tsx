"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";

/**
 * A submit button that switches itself off while its form's Server Action runs, so a double click or a
 * second tap cannot send the same thing twice.
 */
export function PendingButton({ className, children, pendingLabel }: { className: string; children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} aria-disabled={pending}>
      {pending && <LoaderCircle aria-hidden="true" className="spin" size={16} />}
      <span>{pending ? pendingLabel : children}</span>
    </button>
  );
}
