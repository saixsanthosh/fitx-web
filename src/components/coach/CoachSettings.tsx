"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ProviderNotice } from "@/lib/ai/status";
import { CoachRequestError, deleteCoachData, saveConsent } from "./coach-client";

/** Data sharing, who answers, and "Delete my coach data". */
export function CoachSettings({
  open,
  onClose,
  shareData,
  minor,
  ageMissing,
  providers,
  onShareChange,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  shareData: boolean;
  minor: boolean;
  /** No age in the profile: sharing waits for one. */
  ageMissing: boolean;
  providers: ProviderNotice[];
  onShareChange: (shareData: boolean) => void;
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  // Only accounts whose profile says 18 or over can share their data.
  const mayShare = !minor && !ageMissing;
  const on = shareData && mayShare;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  async function toggleSharing() {
    setSaving(true);
    setError("");
    try {
      const result = await saveConsent(!shareData);
      onShareChange(result.consent.shareData);
    } catch (caught) {
      setError(caught instanceof CoachRequestError ? caught.message : "Couldn't change this. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAll() {
    setSaving(true);
    setError("");
    try {
      await deleteCoachData();
      setConfirming(false);
      onDeleted();
    } catch (caught) {
      setError(caught instanceof CoachRequestError ? caught.message : "Couldn't delete your coach data. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="coach-settings-title"
      className="m-auto w-[min(100%-32px,480px)] rounded-2xl border border-fitx-border bg-fitx-elevated p-0 text-fitx-text shadow-2xl backdrop:bg-fitx-scrim/60"
    >
      <div className="flex items-center justify-between border-b border-fitx-divider px-5 py-4">
        <h2 id="coach-settings-title" className="text-base font-semibold">Coach settings</h2>
        <button type="button" onClick={onClose} aria-label="Close coach settings" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="max-h-[70vh] space-y-6 overflow-y-auto px-5 py-5">
        <section aria-labelledby="coach-share-title">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 id="coach-share-title" className="text-sm font-semibold">Use my FITX data</h3>
              <p className="mt-1 text-sm leading-6 text-fitx-text-secondary">
                {minor
                  ? "Off for under-18 accounts: the coach answers general questions only."
                  : ageMissing
                    ? "Off until you add your age in Profile: FITX shares your data with the coach only for accounts of people 18 or over."
                    : shareData
                      ? "On: the coach reads a short summary of your profile, logs and goals. Never your name, email, photos or account ID."
                      : "Off: the coach answers general questions only, and meal and workout plans are off."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby="coach-share-title"
              disabled={!mayShare || saving}
              onClick={toggleSharing}
              className="relative mt-0.5 inline-flex h-11 w-14 shrink-0 items-center justify-center disabled:opacity-50"
            >
              <span aria-hidden="true" className={`block h-7 w-12 rounded-full transition-colors ${on ? "bg-fitx-primary" : "bg-fitx-track"}`} />
              <span aria-hidden="true" className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-fitx-surface shadow transition-all ${on ? "left-[30px]" : "left-[8px]"}`} />
            </button>
          </div>
        </section>

        {providers.length > 0 && (
          <section aria-labelledby="coach-providers-title">
            <h3 id="coach-providers-title" className="text-sm font-semibold">Who answers</h3>
            <ul className="mt-2 space-y-2">
              {providers.map((provider) => (
                <li key={provider.id} className="rounded-lg border border-fitx-border px-3 py-2.5">
                  <p className="text-sm font-medium">{provider.name}</p>
                  <p className="mt-0.5 text-xs leading-5 text-fitx-text-secondary">{provider.dataUse}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="coach-delete-title" className="rounded-xl border border-fitx-danger-border p-4">
          <h3 id="coach-delete-title" className="text-sm font-semibold">Delete my coach data</h3>
          <p className="mt-1 text-sm leading-6 text-fitx-text-secondary">
            Removes every coach conversation and suggestion, FITX’s safety notes and your consent. Foods and workouts you already added stay in Nutrition and Workouts.
          </p>
          {confirming ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={deleteAll} disabled={saving} className="fitx-button fitx-button-danger">{saving ? "Deleting…" : "Yes, delete everything"}</button>
              <button type="button" onClick={() => setConfirming(false)} disabled={saving} className="fitx-button fitx-button-quiet">Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="fitx-button fitx-button-danger mt-3">Delete my coach data</button>
          )}
        </section>
        {error && <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>}
      </div>
    </dialog>
  );
}
