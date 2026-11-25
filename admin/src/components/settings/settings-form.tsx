"use client";

import { useActionState, useId, useRef } from "react";
import { saveSettings } from "@/app/(control)/settings/actions";
import { Panel, consoleStyles as ui } from "@/components/console/ui";
import { keepTyped } from "@/components/content/keep-typed";
import { BusyButton, FormResult } from "@/components/form-kit";
import { fieldAria } from "@/components/form-rules";
import { IDLE } from "@/lib/content/form";
import { FEATURE_LABELS, MAINTENANCE_LIMITS, type FeatureKey } from "./settings-rules";
import styles from "./settings.module.css";

/** The saved settings as the form starts (times already as IST datetime-local values). */
export type SettingsDefaults = {
  updatedAt: string | null;
  /** The Explore switches are shown (20261124100020 is applied). */
  exploreKeys: boolean;
  keys: readonly FeatureKey[];
  features: Record<FeatureKey, boolean>;
  maintenance: { on: boolean; title: string; body: string; starts: string; ends: string };
  /** Off, Showing now, Scheduled or Ended. */
  timing: string;
  site: { supportEmail: string; instagramUrl: string };
};

/**
 * Feature switches, the maintenance notice and website information, saved together. The result shows in the save bar,
 * beside the button: a refusal keeps everything as typed and focuses the field it is about; a save refreshes the page's
 * data (and the "Saved … by" line) without reloading the form.
 */
export function SettingsForm({ defaults, manage }: { defaults: SettingsDefaults; manage: boolean }) {
  const [state, action, pending] = useActionState(saveSettings, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const resultId = useId();
  const aria = (name: string) => fieldAria(state, name, resultId);
  return (
    <form ref={formRef} action={action} onSubmit={keepTyped(action)} className={ui.stack}>
      <input type="hidden" name="updated_at" value={defaults.updatedAt ?? ""} />
      {defaults.exploreKeys && <input type="hidden" name="explore_keys" value="1" />}
      <fieldset className={styles.fieldset} disabled={!manage}>
        <Panel title="Features" hint="Switched-off pages show a short notice instead" className={ui.rise}>
          <fieldset className={styles.switches}>
            <legend className="sr-only">Features</legend>
            {defaults.keys.map((key) => (
              <label className={styles.toggle} key={key}>
                <span><strong>{FEATURE_LABELS[key].label}</strong><small>{FEATURE_LABELS[key].hint}</small></span>
                <span className={styles.end}>
                  <em className={`${styles.state} ${styles.stateOn}`}>On</em><em className={`${styles.state} ${styles.stateOff}`}>Off</em>
                  <input type="checkbox" name={`feature_${key}`} defaultChecked={defaults.features[key]} />
                  <span className={styles.track} aria-hidden="true" />
                </span>
              </label>
            ))}
          </fieldset>
        </Panel>

        <Panel title="Maintenance notice" hint={defaults.timing} className={ui.onScroll}>
          <div className={styles.maintenance}>
            <label className={styles.toggle}>
              <span><strong>Show to signed-in members</strong><small>A banner at the top of every page</small></span>
              <span className={styles.end}><input type="checkbox" name="maintenance_on" defaultChecked={defaults.maintenance.on} /><span className={styles.track} aria-hidden="true" /></span>
            </label>
            <div className={`${styles.maintenanceFields} stack-form`}>
              <label>Title<input name="maintenance_title" maxLength={MAINTENANCE_LIMITS.title} defaultValue={defaults.maintenance.title} placeholder="Planned upgrade tonight" {...aria("maintenance_title")} /></label>
              <label>Message<textarea name="maintenance_body" maxLength={MAINTENANCE_LIMITS.body} rows={3} defaultValue={defaults.maintenance.body} {...aria("maintenance_body")} /></label>
              <div className="form-row">
                <label>From (IST)<input type="datetime-local" name="maintenance_starts" defaultValue={defaults.maintenance.starts} {...aria("maintenance_starts")} /></label>
                <label>Until (IST)<input type="datetime-local" name="maintenance_ends" defaultValue={defaults.maintenance.ends} {...aria("maintenance_ends")} /></label>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Website information" hint="Contact links on the site" className={ui.onScroll}>
          <div className="stack-form">
            <label>Support email<input type="email" name="support_email" required maxLength={254} defaultValue={defaults.site.supportEmail} {...aria("support_email")} /></label>
            <label>Instagram<input type="url" name="instagram_url" required maxLength={200} defaultValue={defaults.site.instagramUrl} {...aria("instagram_url")} /></label>
          </div>
        </Panel>
      </fieldset>
      <div className={styles.saveBar}>
        <div className={styles.saveText}>
          <span>{manage ? "Every save is in the audit log." : "Only a super-admin can change these."}</span>
          <FormResult id={resultId} state={state} formRef={formRef} />
        </div>
        {manage && <BusyButton pending={pending} className="primary-button" pendingLabel="Saving…">Save settings</BusyButton>}
      </div>
    </form>
  );
}
