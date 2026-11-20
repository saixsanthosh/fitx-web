import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { loadSubscriptionPage } from "@/lib/billing/view";
import { BillingHistory } from "./BillingHistory";
import { SubscriptionPanel } from "./SubscriptionPanel";

export const metadata: Metadata = { title: "Subscription" };

// Per-account billing details: always rendered for the request, never prerendered or cached.
export const dynamic = "force-dynamic";

/**
 * No plan can be bought here right now; `configured` is false before Razorpay billing is set up, `paused` is
 * true while Subscriptions is switched off in Admin.
 */
function OpensSoon({ configured, paused = false }: { configured: boolean; paused?: boolean }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-fitx-stage p-6 text-fitx-on-stage sm:p-9" aria-labelledby="subscription-soon">
      <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-fitx-on-stage-secondary">FITX Premium</p>
      <h2 id="subscription-soon" className="mt-3 font-heading text-[28px] font-bold leading-tight tracking-[-.03em] sm:text-[34px]">
        {paused ? "New subscriptions are paused" : configured ? "Premium isn’t on sale right now" : "Subscriptions open soon"}
      </h2>
      <p className="mt-3 max-w-md text-sm leading-6 text-fitx-on-stage-secondary">
        A FITX account is free. Prices show here before anything is charged.
      </p>
      <Link href="/pricing" className="mt-6 inline-flex min-h-11 items-center rounded-full border border-fitx-inverse-divider px-5 text-sm font-semibold transition-colors hover:bg-fitx-on-stage/10 motion-reduce:transition-none">
        See pricing
      </Link>
    </section>
  );
}

export default async function SubscriptionPage() {
  const model = await loadSubscriptionPage();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Subscription" />
      <div className="space-y-5">
      {model.state === "error" ? (
        <p className="fitx-alert fitx-alert-danger" role="alert">
          We couldn’t load your billing details. Check your connection and reload the page.
        </p>
      ) : model.state !== "ready" ? (
        <OpensSoon configured={false} />
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
            <OpensSoon configured={model.mode !== null} paused={model.newSubscriptionsPaused} />
          )}
          {model.current && model.newSubscriptionsPaused && (
            <p className="text-sm text-fitx-text-secondary" role="note">New subscriptions are paused for now.</p>
          )}
          <BillingHistory payments={model.payments} refunds={model.refunds} />
          <p className="text-xs leading-5 text-fitx-text-secondary">
            Payments by Razorpay; FITX never stores card, UPI or bank details. See the{" "}
            <Link href="/terms" className="font-medium text-fitx-primary-text underline underline-offset-2">terms</Link> and{" "}
            <Link href="/refunds" className="font-medium text-fitx-primary-text underline underline-offset-2">refund policy</Link>.
          </p>
        </>
      )}
      </div>
    </div>
  );
}
