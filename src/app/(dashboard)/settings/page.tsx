import type { Metadata } from "next";
import { CircleHelp, CreditCard, Sparkles, UserRound, Watch } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsAccount } from "./SettingsAccount";
import { SettingsAppearance } from "./SettingsAppearance";
import { SettingsData } from "./SettingsData";
import { SettingsGroup, SettingsLink, SettingsRow } from "./SettingsParts";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" />
      <div className="space-y-8">
        <SettingsAccount profile={<SettingsLink href="/profile" icon={UserRound} label="Profile" value="Body, goal, training, food" />} />
        <SettingsAppearance />
        <SettingsGroup id="settings-notifications" title="Notifications">
          <SettingsRow label="Announcements" hint="Shown at the top of FITX. Dismiss each one there.">In app</SettingsRow>
          <SettingsRow label="Email and push">Not offered</SettingsRow>
        </SettingsGroup>
        <SettingsData />
        <SettingsGroup id="settings-connected" title="Connected apps">
          <SettingsLink href="/activity/import" icon={Watch} label="Devices and imports" value="GPX, TCX, FIT" />
        </SettingsGroup>
        <SettingsGroup id="settings-coach" title="AI coach">
          <SettingsLink href="/ai-coach" icon={Sparkles} label="Coach settings" value="Data use, history" />
        </SettingsGroup>
        <SettingsGroup id="settings-elsewhere" title="More">
          <SettingsLink href="/subscription" icon={CreditCard} label="Subscription" />
          <SettingsLink href="/help" icon={CircleHelp} label="Help and feedback" />
        </SettingsGroup>
      </div>
    </div>
  );
}
