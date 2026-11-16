"use client";

import Link from "next/link";
import { useEffect } from "react";
import { House, RotateCcw, TriangleAlert } from "lucide-react";

/** Shown inside the app shell when a page fails to render; the sidebar and bottom bar stay usable. */
export default function DashboardError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center py-12 text-center sm:py-20" aria-labelledby="page-error-title">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-fitx-danger-border bg-fitx-danger-bg text-fitx-danger">
        <TriangleAlert size={24} aria-hidden="true" />
      </span>
      <h1 id="page-error-title" className="mt-6 text-2xl font-semibold tracking-tight text-fitx-text sm:text-3xl">This page didn’t load</h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-fitx-text-secondary">
        Something went wrong while opening it. Your saved workouts, meals and progress are not affected. Try again, or head back to Home.
      </p>
      <div className="mt-7 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <button type="button" onClick={() => unstable_retry()} className="fitx-button"><RotateCcw size={16} aria-hidden="true" />Try again</button>
        <Link href="/dashboard" className="fitx-button fitx-button-secondary"><House size={16} aria-hidden="true" />Go to Home</Link>
      </div>
      {error.digest && <p className="mt-6 text-xs text-fitx-text-secondary">Reference for support: <span className="font-mono">{error.digest}</span></p>}
    </section>
  );
}
