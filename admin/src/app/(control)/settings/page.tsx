import type { Metadata } from "next";
import { PageHead, Panel, consoleStyles as ui } from "@/components/console/ui";
import { ModuleState } from "@/components/module-state";
import { SettingsForm } from "@/components/settings/settings-form";
import { ADMIN_OPS_MIGRATION, FEATURE_KEYS, LEGACY_FEATURE_KEYS, maintenanceTiming } from "@/components/settings/settings-rules";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { exploreReadiness } from "@/lib/data/explore";
import { getPlatformSettings } from "@/lib/data/platform";
import { rootConfigured } from "@/lib/operators";
import { formatIstDateTime, isoToIstInput } from "@/lib/time";

export const metadata: Metadata = { title: "Settings" };

const TIMING = { off: "Off", live: "Showing now", scheduled: "Scheduled", ended: "Ended" } as const;

function readiness(value: boolean, optional: boolean) {
  const label = optional ? (value ? "On" : "Off") : value ? "Set" : "Missing";
  return <span className={`status-pill ${value && !optional ? "status-good" : !value && !optional ? "status-danger" : "status-neutral"}`}><i />{label}</span>;
}

// A save's result shows in the form's own save bar (SettingsForm): nothing in the address is ever shown here.
export default async function SettingsPage() {
  const actor = await requireAdmin("settings.view");
  const manage = hasPermission(actor, "settings.manage");
  const [result, explore] = await Promise.all([getPlatformSettings(), exploreReadiness()]);
  // The Explore switches appear once 20261124100020 is applied; until then the database would refuse them.
  const keys = explore === "ready" ? FEATURE_KEYS : LEGACY_FEATURE_KEYS;
  const env = [
    ["Supabase address", Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL), false],
    ["Supabase publishable key", Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY), false],
    ["Supabase secret key", Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY), false],
    ["Admin address (ADMIN_SITE_URL)", Boolean(process.env.ADMIN_SITE_URL), false],
    ["Owner sign-in", rootConfigured(), false],
    ["Customer site (FITX_SITE_URL)", Boolean(process.env.FITX_SITE_URL), true],
    ["Password reset emails", process.env.FITX_ADMIN_PASSWORD_RESET_EMAILS === "on", true],
    ["Report-only CSP (keep off)", process.env.FITX_ADMIN_CSP_REPORT_ONLY === "1", true],
  ] as const;

  return (
    <div className="page-stack narrow-stack">
      <PageHead
        eyebrow="Settings"
        title="Platform"
        meta={result.state === "ready" && result.updatedAt ? `Saved ${formatIstDateTime(result.updatedAt)}${result.updatedBy ? ` by ${result.updatedBy}` : ""}` : undefined}
      />
      {result.state === "ready" ? (
        <SettingsForm
          manage={manage}
          defaults={{
            updatedAt: result.updatedAt,
            exploreKeys: explore === "ready",
            keys,
            features: result.settings.features,
            maintenance: {
              on: Boolean(result.settings.maintenance),
              title: result.settings.maintenance?.title ?? "",
              body: result.settings.maintenance?.body ?? "",
              starts: isoToIstInput(result.settings.maintenance?.startsAt),
              ends: isoToIstInput(result.settings.maintenance?.endsAt),
            },
            timing: TIMING[maintenanceTiming(result.settings.maintenance)],
            site: result.settings.site,
          }}
        />
      ) : <ModuleState state={result.state} migration={ADMIN_OPS_MIGRATION} />}

      <Panel title="Environment" hint={`${process.env.VERCEL_ENV ?? "local"} · values are never shown`} flush className={ui.onScroll}>
        <ul className="settings-list">
          {env.map(([name, value, optional]) => <li className="settings-row" key={name}><span><strong>{name}</strong></span>{readiness(value, optional)}</li>)}
        </ul>
      </Panel>
    </div>
  );
}
