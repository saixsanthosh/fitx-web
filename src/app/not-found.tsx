import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <main id="main-content" className="fitx-status">
      <Link href="/" aria-label="FITX home" className="fitx-status__brand"><Logo size={34} /></Link>
      <section className="fitx-status__card" aria-labelledby="not-found-title">
        <p className="fitx-status__code">404</p>
        <h1 id="not-found-title" className="fitx-status__title">This page isn’t here.</h1>
        <p className="fitx-status__copy">The address may be mistyped, or the page has moved. Everything you have saved in FITX is still in your account.</p>
        <div className="fitx-status__actions">
          <Link href="/" className="fitx-button fitx-when-signed-out"><ArrowLeft size={16} aria-hidden="true" />Back to FITX</Link>
          <Link href="/dashboard" className="fitx-button fitx-when-signed-in"><LayoutDashboard size={16} aria-hidden="true" />Open your dashboard</Link>
          <Link href="/features" className="fitx-button fitx-button-secondary">See what FITX does</Link>
        </div>
      </section>
    </main>
  );
}
