import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, UserRound } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { SettingsAccount } from "./SettingsAccount";
import { SettingsAppearance } from "./SettingsAppearance";
// SETTINGS-DATA (import): the data stream adds `import { SettingsData } from "./SettingsData";` here.

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeading title="Settings" description="Your account, sign-in, appearance and personal details." />
      <SettingsAccount />
      <SettingsAppearance />
      <section className="fitx-panel p-5" aria-labelledby="settings-profile">
        <h2 id="settings-profile" className="text-base font-semibold text-fitx-text">Profile and training details</h2>
        <p className="mt-1 text-sm text-fitx-text-secondary">Name, body measurements, goals, equipment and food preferences.</p>
        <Link href="/profile" className="mt-3 flex min-h-12 items-center justify-between gap-3 rounded-lg border border-fitx-border px-4 text-sm font-medium text-fitx-text transition-colors hover:bg-fitx-hover">
          <span className="flex items-center gap-3"><UserRound size={18} aria-hidden="true" className="text-fitx-primary" />Edit your profile</span>
          <ChevronRight size={17} aria-hidden="true" className="text-fitx-text-secondary" />
        </Link>
      </section>
      {/* SETTINGS-DATA (section): the data stream renders <SettingsData /> here (export my data, delete my account). */}
    </div>
  );
}
