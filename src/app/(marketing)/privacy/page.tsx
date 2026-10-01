import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/LegalPage";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = { title: "Privacy policy | FITX", description: "Learn what FITX stores, how account data is used, and how to request a change or deletion." };
const updated = "October 1, 2026";
export default function PrivacyPage() {
  const support = BRAND.supportEmail;
  return <LegalPage title="Privacy policy" updated={updated}>
    <section><h2>Who operates FITX</h2><p>FITX is a personal fitness tracking service operated under the FITX name.</p>{support ? <p className="mt-3">Privacy and account requests: <a href={`mailto:${support}`}>{support}</a>.</p> : <p className="mt-3 rounded-lg border border-fitx-border bg-fitx-surface p-3 text-xs">A direct privacy contact has not yet been configured. Do not include personal, health, or account information in a public support post.</p>}</section>
    <section><h2>Information you choose to save</h2><p>Depending on the features you use, FITX stores your account email and profile details, workout preferences, exercise plans and sessions, nutrition entries, custom foods, water logs, goals, and progress measurements. Google sign-in may provide your name, email address, and profile image. Do not enter information you do not want associated with your account.</p></section>
    <section><h2>How the data is used</h2><p>FITX uses account and activity data to authenticate you, save the records you create, calculate summaries from those records, and operate the application. Food searches and barcodes are sent from FITX to Open Food Facts to retrieve matching product data. The app does not sell account data or use it for advertising.</p><p className="mt-3">FITX is hosted on Vercel and uses Supabase for authentication and its application database. Google processes information when you choose Google sign-in. Each provider has its own privacy terms and service operations.</p></section>
    <section><h2>Analytics and storage</h2><p>Optional, aggregate page analytics are disabled until you select “Allow analytics” in the privacy choices banner. FITX removes search strings from page URLs before sending analytics events. Essential Supabase session storage is used to keep sign-in working. The choice to allow or decline analytics is saved in your browser’s local storage.</p></section>
    <section><h2>Retention and requests</h2><p>FITX keeps account records while the account is active and uses them to provide the service. FITX does not currently offer an in-app account deletion button. To request access, correction, export, or deletion, email <a href={`mailto:${support}`}>{support}</a>. Requests may require account verification. No legal response time is promised on this draft page.</p></section>
    <section><h2>Children and health information</h2><p>FITX is not designed as a medical record service. Workout and nutrition summaries are general tracking tools, not medical advice, diagnosis, or treatment. Ask a qualified health professional before making significant changes to exercise or diet, especially if you have a medical condition.</p></section>
    <section><h2>Changes</h2><p>FITX may update this policy when its features or data providers change. The date above shows when this page was last revised.</p></section>
  </LegalPage>;
}
