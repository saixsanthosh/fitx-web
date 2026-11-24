import type { ReactNode } from "react";
import Link from "next/link";
import { LegalPage } from "@/components/layout/LegalPage";
import { BRAND } from "@/config/brand";
import { loadPublicCatalog } from "@/lib/billing/catalog";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({ title: "Terms of use", description: "Terms for using FITX workout planning, food logging, progress tracking and optional Premium subscriptions.", path: "/terms" });

// Says whether subscriptions are on sale, which follows the plans table.
export const revalidate = 300;

/** A point the FITX owner still has to decide; shown until the wording is approved and the marker removed. */
function ToConfirm({ children }: { children: ReactNode }) {
  return (
    <span className="mt-2 block rounded-lg border border-dashed border-fitx-border px-3 py-2 text-xs leading-5">
      <strong className="font-semibold text-fitx-warning">To be confirmed by FITX before subscriptions open:</strong> {children}
    </span>
  );
}

export default async function TermsPage() {
  const support = BRAND.supportEmail;
  const { open } = await loadPublicCatalog();
  return <LegalPage title="Terms of use" updated="17 November 2026">
    <section><h2>Using FITX</h2><p>FITX provides personal tools for workout planning, exercise reference, food search, meal and water logging, and progress summaries. You are responsible for the information you enter and for keeping your sign-in credentials secure.</p></section>
    <section><h2>Health and safety</h2><p>FITX is not medical advice and does not replace a qualified healthcare or fitness professional. Exercise and nutrition choices carry risk. Choose activities appropriate to your abilities, stop if you feel unwell, and seek professional guidance when needed. Nutrition values from external databases may be incomplete or inaccurate; check product packaging for allergy and dietary decisions.</p></section>
    <section><h2>Third-party data and services</h2><p>FITX relies on hosting, authentication, database, payment and food-data providers. Their services may change or become unavailable. Food information is supplied by third parties and should be checked against the original label when accuracy matters.</p></section>
    <section><h2>Acceptable use</h2><p>Do not misuse the service, interfere with its security, scrape it in a way that harms providers, or upload content you are not allowed to share. FITX may restrict access to protect the service or its users.</p></section>
    <section><h2>Availability and changes</h2><p>FITX is provided as an evolving service. Features may be changed, interrupted, or removed. We will update these terms when material changes are made.</p></section>
    <section>
      <h2>Premium subscriptions</h2>
      <p>A FITX account is free. Premium is an optional, paid subscription. {open ? "" : "New Premium subscriptions are not on sale right now. This section applies to every Premium subscription already bought."}</p>
      <ul className="mt-3 space-y-3">
        <li><strong>Price.</strong> Each plan’s price is shown in Indian rupees on the Pricing and Subscription pages before you pay, and that amount is what is charged for each billing period. A subscription keeps the price it started with.
          <ToConfirm>whether prices include GST, the business name shown on receipts, and how FITX tells existing subscribers about a price change.</ToConfirm></li>
        <li><strong>Payment.</strong> Payments are processed by Razorpay. You pay in Razorpay’s checkout window, and FITX never sees your full card number. Razorpay’s payment notices to FITX can include details such as your UPI ID, your card’s last four digits or your bank; FITX discards them and keeps only Razorpay’s references, the amount, the status and the payment method type (for example card or UPI). Razorpay’s own terms and privacy policy also apply to the payment.</li>
        <li><strong>Automatic renewal.</strong> A subscription renews at the end of each billing period (for example monthly or yearly, as shown for the plan) using the payment authorisation you approve in checkout, until you cancel it. Your bank or card issuer may notify you before a renewal charge.</li>
        <li><strong>When Premium starts and ends.</strong> Premium starts when Razorpay confirms your first payment and covers the billing period that payment paid for. If a renewal payment fails, Razorpay retries it; Premium continues for up to 3 days after the paid period while it does, and ends if the payment does not go through.
          <ToConfirm>the 3-day grace period after a failed renewal.</ToConfirm></li>
        <li><strong>Cancelling.</strong> You can cancel at any time on the Subscription page of your account. Cancelling stops all future charges straight away and cannot be undone; Premium stays available until the end of the period you already paid for. You can subscribe again later.</li>
        <li><strong>Refunds.</strong> Refunds are described in the <Link href="/refunds">refund policy</Link>. If a payment is refunded in full, Premium for the period that payment covered ends.</li>
      </ul>
    </section>
    <section><h2>Contact</h2><p>FITX operates under the FITX name. {support ? <>For account, billing or service questions, email <a href={`mailto:${support}`}>{support}</a>.</> : "A direct support email has not yet been configured on this website."}</p>
      <ToConfirm>the legal business name, address and grievance contact that Razorpay and Indian consumer rules require to be published.</ToConfirm></section>
  </LegalPage>;
}
