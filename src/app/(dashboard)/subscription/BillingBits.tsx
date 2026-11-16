import type { ReactNode } from "react";
import type { BillingTone } from "@/lib/billing/status";

export const TONE_CLASSES: Record<BillingTone, string> = {
  good: "border-fitx-success-border bg-fitx-success-bg text-fitx-success",
  warning: "border-fitx-border bg-fitx-surface-variant text-fitx-warning",
  danger: "border-fitx-danger-border bg-fitx-danger-bg text-fitx-danger",
  neutral: "border-fitx-border bg-fitx-surface-variant text-fitx-text-secondary",
};

export function StatusPill({ tone, children }: { tone: BillingTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[tone]}`}>{children}</span>
  );
}

export function TestTag() {
  return (
    <span className="inline-flex items-center rounded border border-fitx-border px-1.5 text-[11px] font-semibold uppercase tracking-wide text-fitx-text-secondary">
      Test
    </span>
  );
}
