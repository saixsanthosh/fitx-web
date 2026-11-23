"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { ConsentRenewal as Renewal } from "@/lib/ai/status";
import { renewConsent } from "./coach-client";
import { markRenewalSeen, renewalSeen, renewalText } from "./renewal";
import styles from "./Coach.module.css";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Shown once, at the top of the coach (page and panel), to a member who agreed to an older consent screen: what the
 * current one adds and a choice. "Agree" stores the current version (their "Use my FITX data" setting stays);
 * "Not now" changes nothing and the prompt does not come back on this device. Coach settings still says which
 * services get only "Questions only" until then.
 */
export function ConsentRenewal({ renewal, onAgreed }: { renewal: Renewal; onAgreed: () => void }) {
  const hydrated = useHydrated();
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!hydrated || closed || renewalSeen(storage(), renewal.version)) return null;

  async function agree() {
    setSaving(true);
    setError("");
    try {
      await renewConsent();
      markRenewalSeen(storage(), renewal.version);
      setClosed(true);
      onAgreed();
    } catch {
      setError("That didn't save. Try again in a moment.");
    } finally {
      setSaving(false);
    }
  }

  function later() {
    markRenewalSeen(storage(), renewal.version);
    setClosed(true);
  }

  return (
    <section className={styles.renewal} aria-labelledby="coach-renewal-title">
      <ShieldCheck size={18} aria-hidden="true" className={styles.renewalIcon} />
      <div className={styles.renewalBody}>
        <h2 id="coach-renewal-title" className={styles.renewalTitle}>Updated coach terms</h2>
        <p>{renewalText(renewal)}</p>
        {error && <p role="alert" className={styles.renewalError}>{error}</p>}
      </div>
      <div className={styles.renewalActions}>
        <button type="button" onClick={later} disabled={saving} className="fitx-button fitx-button-quiet">Not now</button>
        <button type="button" onClick={() => void agree()} disabled={saving} className="fitx-button">{saving ? "Saving…" : "Agree"}</button>
      </div>
    </section>
  );
}
