"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { FitxMark } from "@/components/fitx-mark";
import "./globals.css";

/**
 * Last resort when the root layout itself fails: it replaces the whole document, so it brings its own <html> and
 * <body>. The theme cookie is httpOnly, so this screen follows the device's light or dark setting. Classes only
 * (the nonce CSP allows no style attributes); a plain link because client navigation may be what failed.
 */
export default function AdminGlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <html lang="en-GB">
      <body>
        <title>Error · FITX Admin</title>
        <main className="access-page">
          <div className="access-card" role="alert">
            <span className="access-brand"><FitxMark size={34} /><span>FITX <em>ADMIN</em></span></span>
            <div className="access-icon"><TriangleAlert aria-hidden="true" size={25} /></div>
            <p className="eyebrow">Error</p>
            <h1>Admin did not load</h1>
            <p>Nothing was changed. Try again, or reload Admin in a moment.</p>
            {digest && <p>Reference: {digest}</p>}
            <div className="access-actions">
              <button type="button" className="primary-button" onClick={() => retry()}>Try again</button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="text-link">Reload Admin</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
