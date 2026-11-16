import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/app/PageHeading";
import { loadSubscriptionPage } from "@/lib/billing/view";
import { BillingHistory } from "./BillingHistory";
import { SubscriptionPanel } from "./SubscriptionPanel";

export const metadata: Metadata = { title: "Subscription" };

function OpensSoon() {
  return (
    <section className="fitx-panel p-6 sm:p-8" aria-labelledby="subscription-soon">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-fitx-primary-text">FITX Premium</p>
      <h2 id="subscription-soon" className="mt-3 text-2xl font-semibold tracking-tight text-fitx-text">Subscriptions open soon</h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-fitx-text-secondary">
        Everything in FITX today is free to use. When paid plans open, their prices and what they include will be shown here
        before anything is charged.
      </p>
      <Link href="/pricing" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-fitx-primary-text underline-offset-4 hover:underline">
        See pricing
      </Link>
    </section>
  );
}

export default async function SubscriptionPage() {
  const model = await loadSubscriptionPage();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeading title="Subscription" description="FITX Premium, renewals and your payment history." />
      {model.state === "error" ? (
        <p className="fitx-alert fitx-alert-danger" role="alert">
          We couldn’t load your billing details. Check your connection and reload the page.
        </p>
      ) : model.state !== "ready" ? (
        <OpensSoon />
      ) : (
        <>
          {model.current || model.checkoutOpen ? (
            <SubscriptionPanel
              current={model.current}
              premium={model.premium}
              plans={model.plans}
              checkoutOpen={model.checkoutOpen}
              mode={model.mode}
            />
          ) : (
            <OpensSoon />
          )}
          <BillingHistory payments={model.payments} refunds={model.refunds} />
          <p className="text-xs leading-5 text-fitx-text-secondary">
            Payments are processed by Razorpay; FITX never sees your card or UPI details. Read the{" "}
            <Link href="/terms" className="font-medium text-fitx-primary-text underline underline-offset-2">terms</Link> and{" "}
            <Link href="/refunds" className="font-medium text-fitx-primary-text underline underline-offset-2">refund policy</Link>.
          </p>
        </>
      )}
    </div>
  );
}
