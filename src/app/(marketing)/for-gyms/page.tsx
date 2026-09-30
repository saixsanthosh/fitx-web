import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "For gyms | FITX", description: "FITX is currently designed for individual fitness tracking." };
export default function ForGymsPage() {
  return <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-16 sm:px-6 lg:px-8 lg:py-24"><p className="text-xs font-semibold uppercase tracking-[.2em] text-fitx-primary">For gyms</p><h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">FITX is currently for individual training.</h1><p className="mt-5 max-w-2xl text-base leading-7 text-fitx-text-secondary">Gym management, member billing, and staff dashboards are not available in FITX today. The current app focuses on personal workout planning, food logging, and progress history.</p><Link href="/features" className="fitx-button mt-8 min-h-11 px-4">See current features</Link></main>;
}
