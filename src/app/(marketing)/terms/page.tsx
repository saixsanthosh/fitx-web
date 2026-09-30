import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/LegalPage";

export const metadata: Metadata = { title: "Terms of use | FITX", description: "Terms for using FITX workout planning, food logging, and progress tracking." };
export default function TermsPage() {
  const support = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return <LegalPage title="Terms of use" updated="September 30, 2026">
    <section><h2>Using FITX</h2><p>FITX provides personal tools for workout planning, exercise reference, food search, meal and water logging, and progress summaries. You are responsible for the information you enter and for keeping your sign-in credentials secure.</p></section>
    <section><h2>Health and safety</h2><p>FITX is not medical advice and does not replace a qualified healthcare or fitness professional. Exercise and nutrition choices carry risk. Choose activities appropriate to your abilities, stop if you feel unwell, and seek professional guidance when needed. Nutrition values from external databases may be incomplete or inaccurate; check product packaging for allergy and dietary decisions.</p></section>
    <section><h2>Third-party data and services</h2><p>FITX relies on hosting, authentication, database, and food-data providers. Their services may change or become unavailable. Food information is supplied by third parties and should be checked against the original label when accuracy matters.</p></section>
    <section><h2>Acceptable use</h2><p>Do not misuse the service, interfere with its security, scrape it in a way that harms providers, or upload content you are not allowed to share. FITX may restrict access to protect the service or its users.</p></section>
    <section><h2>Availability and changes</h2><p>FITX is provided as an evolving service. Features may be changed, interrupted, or removed. We will update these terms when material changes are made.</p></section>
    <section><h2>Payments</h2><p>FITX currently has no paid subscriptions or in-app purchases. If paid features are added, pricing and applicable terms will be shown before a purchase.</p></section>
    <section><h2>Contact</h2><p>FITX operates under the FITX name. {support ? <>For account or service questions, email <a href={`mailto:${support}`}>{support}</a>.</> : "A direct support email has not yet been configured on this website."}</p></section>
  </LegalPage>;
}
