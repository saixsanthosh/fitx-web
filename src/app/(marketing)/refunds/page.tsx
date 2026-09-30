import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/LegalPage";

export const metadata: Metadata = { title: "Refund policy | FITX", description: "FITX currently has no paid plans or in-app purchases." };
export default function RefundsPage() {
  return <LegalPage title="Refund policy" updated="September 30, 2026">
    <section><h2>No paid purchases today</h2><p>FITX currently does not offer a paid subscription, paid download, or in-app purchase. No payment is collected by the app, so there are no FITX charges to refund at this time.</p></section>
    <section><h2>If paid features are introduced</h2><p>FITX will publish updated pricing and refund terms before accepting payment for a paid feature. Any refund rights required by applicable law will continue to apply.</p></section>
  </LegalPage>;
}
