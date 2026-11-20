"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

type Props = {
  error: Error & { digest?: string };
  retry: () => void;
  /** Where the second button goes, and what it says. */
  home: { href: string; label: string };
  /** "div" inside a layout that already has its own <main> (the sign-in shell). */
  landmark?: "main" | "div";
};

/**
 * The error screen of the public, sign-in and root boundaries. It never shows the error's message or stack (in
 * production React replaces server errors with a generic one anyway); only the digest, which matches the server log.
 */
export function ErrorScreen({ error, retry, home, landmark = "main" }: Props) {
  const Root = landmark;
  useEffect(() => {
    // The digest is what the server log holds; the message stays out of the page.
    console.error("[fitx] page error", error.digest ?? error.name);
  }, [error]);

  return (
    <Root {...(landmark === "main" ? { id: "main-content" } : {})} className="fitx-status">
      <span className="fitx-status__brand"><Logo size={34} /></span>
      <section className="fitx-status__card" aria-labelledby="page-error-title">
        <h1 id="page-error-title" className="fitx-status__title">This page didn’t load</h1>
        <p className="fitx-status__copy">Your saved data is safe. Try again in a moment.</p>
        <div className="fitx-status__actions">
          <button type="button" onClick={() => retry()} className="fitx-button"><RotateCcw size={16} aria-hidden="true" />Try again</button>
          <Link href={home.href} className="fitx-button fitx-button-secondary">{home.label}</Link>
        </div>
        {error.digest && <p className="fitx-status__ref">Reference for support: <span>{error.digest}</span></p>}
      </section>
    </Root>
  );
}
