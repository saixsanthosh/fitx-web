import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/app/PageHeading";
import { ThemeSwitcher } from "@/components/ui/ThemeSwitcher";
import { IntroReplayControl } from "@/components/brand/IntroReplayControl";
import { SettingsAccount } from "./SettingsAccount";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeading title="Settings" description="Your account, sign-in and how FITX looks on this device." />
      <SettingsAccount />
      <section className="fitx-panel p-5" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" className="text-base font-semibold text-fitx-text">Appearance</h2>
        <p className="mt-1 text-sm text-fitx-text-secondary">Light, dark, or match this device’s setting.</p>
        <div className="mt-4"><ThemeSwitcher /></div>
        <div className="mt-4 border-t border-fitx-divider pt-4"><IntroReplayControl className="inline-flex min-h-11 items-center text-sm font-medium text-fitx-primary" /></div>
      </section>
      <section className="fitx-panel p-5" aria-labelledby="settings-profile">
        <h2 id="settings-profile" className="text-base font-semibold text-fitx-text">Profile and training details</h2>
        <p className="mt-1 text-sm text-fitx-text-secondary">Name, body measurements, goals, equipment and preferences.</p>
        <Link href="/profile" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-fitx-primary">Edit your profile</Link>
      </section>
    </div>
  );
}
