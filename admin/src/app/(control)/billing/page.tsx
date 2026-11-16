import type { Metadata } from "next";
import { CreditCard } from "lucide-react";

export const metadata: Metadata = { title: "Billing" };
export default function BillingPage() {
  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><p className="eyebrow">SUBSCRIPTIONS & PAYMENTS</p><h1>Billing</h1><p className="page-lede">Payment operations are kept tied to verified provider records.</p></div><span className="page-heading-icon"><CreditCard aria-hidden="true" size={20} /></span></div>
      <section className="report-note module-explanation"><p className="eyebrow">CURRENT FITX OFFERING</p><h2>No paid plans are connected.</h2><p>FITX’s current pricing information describes the app as free and does not record paid subscriptions. No payment provider, transaction, refund, or revenue source is connected to this Admin application, so none is reported here.</p></section>
    </div>
  );
}
