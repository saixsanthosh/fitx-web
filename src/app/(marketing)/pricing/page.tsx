import Link from "next/link";
import { Check } from "lucide-react";
import { loadPublicCatalog } from "@/lib/billing/catalog";
import { formatInr, periodLabel } from "@/lib/billing/money";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Pricing",
  description: "What FITX costs: the free account, and any premium plan with its price in Indian rupees shown before you pay.",
  path: "/pricing",
});

// Plans come from the billing_plans table; the page is rebuilt at most every five minutes.
export const revalidate = 300;

const FREE_FEATURES = [
  "Workout planning and active sessions",
  "Exercise search with instructions",
  "Food search, barcode lookup and meal logging",
  "Water tracking",
  "Progress history",
];

export default async function PricingPage() {
  const catalog = await loadPublicCatalog();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <p className="text-xs font-semibold uppercase tracking-[.2em] text-fitx-primary-text">Pricing</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
        {catalog.open ? "Free to use. Premium when you want more." : "Free to use."}
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-fitx-text-secondary">
        {catalog.open
          ? "A FITX account costs nothing. Premium plans are optional subscriptions, charged in Indian rupees through Razorpay."
          : "FITX is available without a subscription or in-app purchase. No payment details are needed to create an account."}
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <section className="fitx-panel flex flex-col p-6" aria-labelledby="plan-free">
          <h2 id="plan-free" className="text-sm font-semibold text-fitx-primary-text">FITX account</h2>
          <p className="mt-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold tracking-tight">{formatInr(0)}</span>
            <span className="text-sm text-fitx-text-secondary">free</span>
          </p>
          <ul className="mt-4 space-y-2 text-sm text-fitx-text">
            {FREE_FEATURES.map((feature) => (
              <li key={feature} className="flex gap-2">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fitx-success" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-fitx-text-secondary">Food data providers may apply their own fair-use limits.</p>
          <div className="mt-auto pt-6">
            <Link href="/signup" className="fitx-button fitx-button-secondary min-h-11 w-full">
              Create account
            </Link>
          </div>
        </section>

        {catalog.open ? (
          catalog.plans.map((plan) => (
            <section key={plan.id} className="fitx-panel flex flex-col p-6" aria-labelledby={`plan-${plan.code}`}>
              <h2 id={`plan-${plan.code}`} className="text-sm font-semibold text-fitx-primary-text">{plan.name}</h2>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight tabular-nums">{formatInr(plan.amountPaise)}</span>
                <span className="text-sm text-fitx-text-secondary">{periodLabel(plan.period, plan.interval)}</span>
              </p>
              {plan.description && <p className="mt-3 text-sm leading-6 text-fitx-text-secondary">{plan.description}</p>}
              {plan.features.length > 0 && (
                <ul className="mt-4 space-y-2 text-sm text-fitx-text">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fitx-success" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto pt-6">
                <Link href="/subscription" className="fitx-button min-h-11 w-full">
                  Choose {plan.name}
                </Link>
              </div>
            </section>
          ))
        ) : (
          <section className="fitx-panel flex flex-col p-6" aria-labelledby="plan-premium">
            <h2 id="plan-premium" className="text-sm font-semibold text-fitx-primary-text">FITX Premium</h2>
            <p className="mt-3 text-2xl font-semibold tracking-tight">
              {catalog.reason === "not_configured" ? "Subscriptions open soon" : "Not on sale right now"}
            </p>
            <p className="mt-3 text-sm leading-6 text-fitx-text-secondary">
              When Premium plans are on sale, each plan’s price and what it includes are listed here before you pay.
            </p>
          </section>
        )}
      </div>

      {catalog.open ? (
        <div className="mt-8 max-w-3xl space-y-2 text-xs leading-5 text-fitx-text-secondary">
          <p>
            The price shown is the amount charged at checkout. A subscription renews automatically at the end of each billing period
            until you cancel. Cancelling stops all future charges straight away, and Premium stays on until the end of the period you
            paid for.
          </p>
          <p>
            Payments are processed by Razorpay; FITX never stores your card, UPI or bank details. See the{" "}
            <Link href="/terms" className="font-medium text-fitx-primary-text underline underline-offset-2">terms</Link> and{" "}
            <Link href="/refunds" className="font-medium text-fitx-primary-text underline underline-offset-2">refund policy</Link>.
          </p>
        </div>
      ) : (
        <p className="mt-6 text-xs text-fitx-text-secondary">Prices and terms for any paid plan are published here before it is sold.</p>
      )}
    </main>
  );
}
