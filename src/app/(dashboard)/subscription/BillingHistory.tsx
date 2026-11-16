import { formatAmount, formatInr } from "@/lib/billing/money";
import { formatBillingDate, paymentMethodLabel, paymentStatusLabel, paymentTone, refundStatusLabel } from "@/lib/billing/status";
import type { PaymentView, RefundView } from "@/lib/billing/types";
import { StatusPill, TestTag } from "./BillingBits";

function periodText(payment: PaymentView) {
  const start = formatBillingDate(payment.periodStart);
  const end = formatBillingDate(payment.periodEnd);
  return start && end ? `${start} – ${end}` : null;
}

/** The account's own payments and refunds, newest first, as Razorpay reported them. */
export function BillingHistory({ payments, refunds }: { payments: PaymentView[]; refunds: RefundView[] }) {
  if (!payments.length && !refunds.length) return null;
  return (
    <section className="fitx-panel p-5" aria-labelledby="billing-history">
      <h2 id="billing-history" className="text-base font-semibold text-fitx-text">Payment history</h2>
      <p className="mt-1 text-sm text-fitx-text-secondary">Charges and refunds as Razorpay recorded them. Dates are in India Standard Time.</p>
      {payments.length > 0 && (
        <ul className="mt-4 divide-y divide-fitx-divider border-y border-fitx-divider">
          {payments.map((payment) => {
            const period = periodText(payment);
            return (
              <li key={payment.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fitx-text">
                    {formatBillingDate(payment.at) ?? "Date unavailable"}
                    <StatusPill tone={paymentTone(payment.status)}>{paymentStatusLabel(payment.status, payment.refundedPaise)}</StatusPill>
                    {payment.mode === "test" && <TestTag />}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">
                    {paymentMethodLabel(payment.method)}
                    {period ? ` · for ${period}` : ""}
                    {payment.status === "failed" && payment.failureReason ? ` · ${payment.failureReason}` : ""}
                    {payment.refundedPaise > 0 && payment.status !== "refunded" ? ` · ${formatInr(payment.refundedPaise)} refunded` : ""}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-fitx-text">{formatAmount(payment.amountPaise, payment.currency)}</p>
              </li>
            );
          })}
        </ul>
      )}
      {refunds.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-fitx-text">Refunds</h3>
          <ul className="mt-2 divide-y divide-fitx-divider border-y border-fitx-divider">
            {refunds.map((refund) => (
              <li key={refund.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                <p className="flex flex-wrap items-center gap-2 text-sm text-fitx-text">
                  {formatBillingDate(refund.processedAt ?? refund.at) ?? "Date unavailable"}
                  <StatusPill tone={refund.status === "failed" ? "danger" : refund.status === "processed" ? "good" : "neutral"}>
                    {refundStatusLabel(refund.status)}
                  </StatusPill>
                  {refund.mode === "test" && <TestTag />}
                </p>
                <p className="text-sm font-semibold tabular-nums text-fitx-text">{formatAmount(refund.amountPaise, refund.currency)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-5 text-fitx-text-secondary">
            Refunds go back to the original payment method. Your bank decides how long it takes to show.
          </p>
        </>
      )}
    </section>
  );
}
