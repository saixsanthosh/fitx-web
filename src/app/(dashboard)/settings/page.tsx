import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, CircleHelp, CreditCard, Sparkles, UserRound } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { SettingsAccount } from "./SettingsAccount";
import { SettingsAppearance } from "./SettingsAppearance";
import { SettingsData } from "./SettingsData";

export const metadata: Metadata = { title: "Settings" };

/** Settings that live on their own pages. */
const ELSEWHERE = [
  { href: "/ai-coach", label: "AI coach", hint: "Choose whether the coach uses your FITX data, or delete your coach data, in Coach settings.", icon: Sparkles },
  { href: "/subscription", label: "Subscription", hint: "Premium, renewals and payment history", icon: CreditCard },
  { href: "/help", label: "Help and feedback", hint: "Ask a question, report a problem or share an idea with the FITX team.", icon: CircleHelp },
] as const;

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeading title="Settings" description="Your account, sign-in, appearance and personal details." />
      <SettingsAccount />
      <SettingsData />
      <SettingsAppearance />
      <section className="fitx-panel p-5" aria-labelledby="settings-profile">
        <h2 id="settings-profile" className="text-base font-semibold text-fitx-text">Profile and training details</h2>
        <p className="mt-1 text-sm text-fitx-text-secondary">Name, body measurements, goals, equipment and food preferences.</p>
        <Link href="/profile" className="mt-3 flex min-h-12 items-center justify-between gap-3 rounded-lg border border-fitx-border px-4 text-sm font-medium text-fitx-text transition-colors hover:bg-fitx-hover">
          <span className="flex items-center gap-3"><UserRound size={18} aria-hidden="true" className="text-fitx-primary" />Edit your profile</span>
          <ChevronRight size={17} aria-hidden="true" className="text-fitx-text-secondary" />
        </Link>
      </section>
      <section className="fitx-panel p-5" aria-labelledby="settings-elsewhere">
        <h2 id="settings-elsewhere" className="text-base font-semibold text-fitx-text">Coach, subscription and help</h2>
        <ul className="mt-3 space-y-2">
          {ELSEWHERE.map(({ href, label, hint, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-fitx-border px-4 py-2.5 text-sm transition-colors hover:bg-fitx-hover">
                <span className="flex min-w-0 items-center gap-3">
                  <Icon size={18} aria-hidden="true" className="shrink-0 text-fitx-primary" />
                  <span className="min-w-0">
                    <span className="block font-medium text-fitx-text">{label}</span>
                    <span className="block text-xs leading-5 text-fitx-text-secondary">{hint}</span>
                  </span>
                </span>
                <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-fitx-text-secondary" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
