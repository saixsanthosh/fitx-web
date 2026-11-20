"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { FitxMark } from "@/components/fitx-mark";

/**
 * An unexpected failure in any Admin page. Classes only (the nonce CSP allows no style attributes), and nothing
 * from the error but its digest: Server Component errors reach the browser without their message in production.
 */
export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <main className="access-page">
      <div className="access-card" role="alert">
        <span className="access-brand"><FitxMark size={34} /><span>FITX <em>ADMIN</em></span></span>
        <div className="access-icon"><TriangleAlert aria-hidden="true" size={25} /></div>
        <p className="eyebrow">Error</p>
        <h1>This page did not load</h1>
        <p>Nothing was changed. Try again, or go back to Admin.</p>
        {digest && <p>Reference: {digest}</p>}
        <div className="access-actions">
          <button type="button" className="primary-button" onClick={() => retry()}>Try again</button>
          <Link href="/" className="text-link">Back to Admin</Link>
        </div>
      </div>
    </main>
  );
}
