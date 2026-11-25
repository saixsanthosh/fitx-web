import type { ReactNode } from "react";
import Link from "next/link";
import { LegalPage } from "@/components/layout/LegalPage";
import { BRAND } from "@/config/brand";
import { loadPublicCatalog } from "@/lib/billing/catalog";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({ title: "Refund policy", description: "How cancelling and refunds work for optional FITX Premium subscriptions paid through Razorpay.", path: "/refunds" });

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

export default async function RefundsPage() {
  const support = BRAND.supportEmail;
  const { open } = await loadPublicCatalog();
  return <LegalPage title="Refund policy" updated="17 November 2026">
    <section><h2>Free features</h2><p>A FITX account and its free features cost nothing, so there is nothing to refund for them.</p></section>
    <section>
      <h2>Premium subscriptions</h2>
      {!open && <p>New Premium subscriptions are not on sale right now. If you already pay for Premium, this policy applies to your payments.</p>}
      <ul className="mt-3 space-y-3">
        <li><strong>Cancelling is not a refund.</strong> Cancelling on the <Link href="/subscription" prefetch={false}>Subscription page</Link> stops every future charge at once. The current period is not refunded automatically; you keep Premium until it ends.</li>
        <li><strong>Asking for a refund.</strong> If you were charged in a way you did not expect, for example twice for the same period or for a renewal you had meant to cancel, email {support ? <a href={`mailto:${support}`}>{support}</a> : "FITX support"} with the date and amount of the charge and the email address of your FITX account. FITX checks the payment in its Razorpay records and replies to you.
          <ToConfirm>which charges are refundable and within how many days of the charge, whether a partly used period is refunded in part, and how quickly FITX replies to requests.</ToConfirm></li>
        <li><strong>How refunds are paid.</strong> Approved refunds are issued through Razorpay to the original payment method, such as the same card, UPI account or bank account. They cannot be paid in cash or to another account. After FITX issues a refund, your bank or card issuer decides how long it takes to appear, usually several working days.</li>
        <li><strong>Premium after a refund.</strong> If a payment is refunded in full, Premium for the period that payment covered ends once Razorpay reports the refund. A partial refund does not end Premium.
          <ToConfirm>whether a partial refund should end Premium.</ToConfirm></li>
        <li><strong>Your rights.</strong> Any refund rights you have under applicable law, including Indian consumer protection law, are not affected by this policy.</li>
      </ul>
    </section>
  </LegalPage>;
}
