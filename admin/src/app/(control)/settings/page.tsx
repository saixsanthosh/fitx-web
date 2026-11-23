import type { Metadata } from "next";
import { Notice, PageHead, Panel, consoleStyles as ui } from "@/components/console/ui";
import { ModuleState } from "@/components/module-state";
import { PendingButton } from "@/components/pending-button";
import { ADMIN_OPS_MIGRATION, FEATURE_KEYS, FEATURE_LABELS, LEGACY_FEATURE_KEYS, MAINTENANCE_LIMITS, maintenanceTiming } from "@/components/settings/settings-rules";
import styles from "@/components/settings/settings.module.css";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { exploreReadiness } from "@/lib/data/explore";
import { getPlatformSettings } from "@/lib/data/platform";
import { rootConfigured } from "@/lib/operators";
import { firstParam } from "@/lib/search-params";
import { formatIstDateTime, isoToIstInput } from "@/lib/time";
import { saveSettings } from "./actions";

export const metadata: Metadata = { title: "Settings" };

const NOTICES: Record<string, { tone: "success" | "error"; text: string }> = {
  saved: { tone: "success", text: "Saved. The app picks it up within a minute." },
  changed: { tone: "error", text: "Someone saved these settings after you opened them. Check the latest values and save again." },
  forbidden: { tone: "error", text: "Only a super-admin can change settings." },
  migration: { tone: "error", text: `Settings need migration ${ADMIN_OPS_MIGRATION}.` },
  configuration: { tone: "error", text: "Server data access is not configured." },
  failed: { tone: "error", text: "Not saved. The server log has the details." },
};

function readiness(value: boolean, optional: boolean) {
  const label = optional ? (value ? "On" : "Off") : value ? "Set" : "Missing";
  return <span className={`status-pill ${value && !optional ? "status-good" : !value && !optional ? "status-danger" : "status-neutral"}`}><i />{label}</span>;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("settings.view");
  const params = await searchParams;
  const state = firstParam(params.state);
  const notice = state === "invalid" ? { tone: "error" as const, text: firstParam(params.message).slice(0, 200) || "Check the values and save again." } : NOTICES[state];
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
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {result.state === "ready" ? (
        <form action={saveSettings} className={ui.stack}>
          <input type="hidden" name="updated_at" value={result.updatedAt ?? ""} />
          {explore === "ready" && <input type="hidden" name="explore_keys" value="1" />}
          <fieldset className={styles.fieldset} disabled={!manage}>
            <Panel title="Features" hint="Switched-off pages show a short notice instead" className={ui.rise}>
              <fieldset className={styles.switches}>
                <legend className="sr-only">Features</legend>
                {keys.map((key) => (
                  <label className={styles.toggle} key={key}>
                    <span><strong>{FEATURE_LABELS[key].label}</strong><small>{FEATURE_LABELS[key].hint}</small></span>
                    <span className={styles.end}>
                      <em className={`${styles.state} ${styles.stateOn}`}>On</em><em className={`${styles.state} ${styles.stateOff}`}>Off</em>
                      <input type="checkbox" name={`feature_${key}`} defaultChecked={result.settings.features[key]} />
                      <span className={styles.track} aria-hidden="true" />
                    </span>
                  </label>
                ))}
              </fieldset>
            </Panel>

            <Panel title="Maintenance notice" hint={({ off: "Off", live: "Showing now", scheduled: "Scheduled", ended: "Ended" } as const)[maintenanceTiming(result.settings.maintenance)]} className={ui.onScroll}>
              <div className={styles.maintenance}>
                <label className={styles.toggle}>
                  <span><strong>Show to signed-in members</strong><small>A banner at the top of every page</small></span>
                  <span className={styles.end}><input type="checkbox" name="maintenance_on" defaultChecked={Boolean(result.settings.maintenance)} /><span className={styles.track} aria-hidden="true" /></span>
                </label>
                <div className={`${styles.maintenanceFields} stack-form`}>
                  <label>Title<input name="maintenance_title" maxLength={MAINTENANCE_LIMITS.title} defaultValue={result.settings.maintenance?.title ?? ""} placeholder="Planned upgrade tonight" /></label>
                  <label>Message<textarea name="maintenance_body" maxLength={MAINTENANCE_LIMITS.body} rows={3} defaultValue={result.settings.maintenance?.body ?? ""} /></label>
                  <div className="form-row">
                    <label>From (IST)<input type="datetime-local" name="maintenance_starts" defaultValue={isoToIstInput(result.settings.maintenance?.startsAt)} /></label>
                    <label>Until (IST)<input type="datetime-local" name="maintenance_ends" defaultValue={isoToIstInput(result.settings.maintenance?.endsAt)} /></label>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Website information" hint="Contact links on the site" className={ui.onScroll}>
              <div className="stack-form">
                <label>Support email<input type="email" name="support_email" required maxLength={254} defaultValue={result.settings.site.supportEmail} /></label>
                <label>Instagram<input type="url" name="instagram_url" required maxLength={200} defaultValue={result.settings.site.instagramUrl} /></label>
              </div>
            </Panel>
          </fieldset>
          <div className={styles.saveBar}>
            <span>{manage ? "Every save is in the audit log." : "Only a super-admin can change these."}</span>
            {manage && <PendingButton className="primary-button" pendingLabel="Saving…">Save settings</PendingButton>}
          </div>
        </form>
      ) : <ModuleState state={result.state} migration={ADMIN_OPS_MIGRATION} />}

      <Panel title="Environment" hint={`${process.env.VERCEL_ENV ?? "local"} · values are never shown`} flush className={ui.onScroll}>
        <ul className="settings-list">
          {env.map(([name, value, optional]) => <li className="settings-row" key={name}><span><strong>{name}</strong></span>{readiness(value, optional)}</li>)}
        </ul>
      </Panel>
    </div>
  );
}
