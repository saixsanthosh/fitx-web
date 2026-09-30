import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/LegalPage";
import { CookiePreferences } from "@/components/layout/CookiePreferences";

export const metadata: Metadata = { title: "Cookie policy | FITX", description: "See how FITX uses essential sign-in storage and optional analytics." };
export default function CookiesPage() {
  return <LegalPage title="Cookie and storage policy" updated="September 30, 2026">
    <section><h2>Essential sign-in storage</h2><p>Supabase uses browser cookies to keep your session active and secure after you sign in. These are needed for core account features and cannot be disabled from within FITX while you use a signed-in area.</p></section>
    <section><h2>Privacy choice</h2><p>FITX saves your analytics choice in local storage. Select “Essential only” to decline optional page analytics or “Allow analytics” to enable them. You can change this setting here at any time.</p><div className="mt-3"><CookiePreferences/></div></section>
    <section><h2>Optional analytics</h2><p>If allowed, Vercel Web Analytics receives aggregate page-view events. FITX removes search strings from the page URL first. Vercel describes its analytics as not collecting personal identifiers used to track people across different websites. Analytics events do not use advertising cookies.</p></section>
    <section><h2>Managing storage</h2><p>You can clear browser site data in your browser settings. Clearing essential session data signs you out. Declining optional analytics does not affect sign-in or workout and nutrition features.</p></section>
  </LegalPage>;
}
