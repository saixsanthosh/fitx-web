"use client";

import { useEffect } from "react";
import { Logo } from "@/components/ui/Logo";
import "./globals.css";

/**
 * Last-resort screen when the root layout itself fails. It replaces the whole document, so it brings
 * its own <html>, <body> and styles, and applies the saved theme itself.
 */
export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error(error);
    try {
      const saved = window.localStorage.getItem("fitx-theme");
      document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      document.documentElement.dataset.theme = "system";
    }
  }, [error]);

  return (
    <html lang="en" data-theme="system">
      {/* The root layout's font variables are not available here, so use the system font. */}
      <body style={{ fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif" }}>
        <title>Something went wrong | FITX</title>
        <main className="fitx-status">
          <span className="fitx-status__brand"><Logo size={34} /></span>
          <section className="fitx-status__card" aria-labelledby="global-error-title">
            <h1 id="global-error-title" className="fitx-status__title">FITX couldn’t open this page.</h1>
            <p className="fitx-status__copy">Something went wrong on our side. Your saved data is safe. Try again, or reload the page in a moment.</p>
            <div className="fitx-status__actions">
              <button type="button" onClick={() => unstable_retry()} className="fitx-button">Try again</button>
              {/* A plain link: client navigation may be what failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="fitx-button fitx-button-secondary">Go to the home page</a>
            </div>
            {error.digest && <p className="fitx-status__ref">Reference for support: <span>{error.digest}</span></p>}
          </section>
        </main>
      </body>
    </html>
  );
}
