import type { Metadata } from "next";
import Link from "next/link";
import { PauseCircle } from "lucide-react";
import { FEATURE_NAMES, isFeatureKey } from "@/lib/platform/settings";

export const metadata: Metadata = { title: "Paused", robots: { index: false } };

/**
 * Where a switched-off feature lands (src/lib/platform/gate.ts rewrites the page here, so the address stays
 * the one the member opened). The FITX team switches features in Admin, Settings.
 */
export default async function UnavailablePage({ searchParams }: { searchParams: Promise<{ feature?: string | string[] }> }) {
  const raw = (await searchParams).feature;
  const feature = typeof raw === "string" && isFeatureKey(raw) ? raw : null;
  const name = feature ? FEATURE_NAMES[feature] : "This page";
  return (
    <div className="mx-auto grid min-h-[60svh] max-w-md place-items-center px-4 py-12 text-center">
      <div className="grid justify-items-center gap-4">
        <span className="grid size-16 place-items-center rounded-2xl border border-fitx-border bg-fitx-surface text-fitx-primary-text" aria-hidden="true">
          <PauseCircle size={30} strokeWidth={1.6} />
        </span>
        <h1 className="font-heading text-[28px] font-bold leading-tight tracking-[-.03em] text-fitx-text">{name} is paused</h1>
        <p className="text-sm leading-6 text-fitx-text-secondary">Back soon. Your data is safe.</p>
        <Link href="/dashboard" className="fitx-button mt-2 min-h-11 px-5">Back to Home</Link>
      </div>
    </div>
  );
}
