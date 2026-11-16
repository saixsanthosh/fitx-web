"use client";

import { useState } from "react";
import Link from "next/link";
import { Dumbbell, LockKeyhole, MessageCircle, ShieldCheck, Utensils } from "lucide-react";
import type { ProviderNotice } from "@/lib/ai/status";
import { cn } from "@/lib/utils";
import { CoachRequestError, saveConsent } from "./coach-client";

/**
 * The first screen of the coach: what it does, exactly what it would share and with whom, and a
 * real choice. Nothing is sent anywhere until the member presses "Start coaching".
 */
export function ConsentPanel({ providers, sharedSummary, minor, onDone }: { providers: ProviderNotice[]; sharedSummary: string[]; minor: boolean; onDone: (shareData: boolean) => void }) {
  const [shareData, setShareData] = useState(!minor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setSaving(true);
    setError("");
    try {
      const result = await saveConsent(shareData && !minor);
      onDone(result.consent.shareData);
    } catch (caught) {
      setError(caught instanceof CoachRequestError ? caught.message : "Couldn't save your choice. Please try again.");
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="coach-consent-title" className="mx-auto max-w-2xl">
      <div className="fitx-panel overflow-hidden">
        <div className="border-b border-fitx-divider px-5 py-6 sm:px-8 sm:py-8">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-fitx-primary-text">FITX Coach</p>
          <h2 id="coach-consent-title" className="mt-2 text-[24px] font-bold leading-tight tracking-[-.03em] text-fitx-text sm:text-[28px]">Coaching built on your own numbers</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-fitx-text-secondary">
            The coach uses free AI services to answer your questions. FITX checks every food it suggests against its nutrition data, and every exercise against its exercise library.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { icon: MessageCircle, title: "Ask anything", text: "Training, food and recovery questions" },
              { icon: Utensils, title: "Meal plans", text: minor ? "Not available under 18" : "Fit your diet, allergies and budget" },
              { icon: Dumbbell, title: "Workouts", text: minor ? "Not available under 18" : "Only exercises you can do with your kit" },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-lg border border-fitx-border bg-fitx-surface-variant/60 p-3">
                <Icon size={18} aria-hidden="true" className="text-fitx-primary" />
                <p className="mt-2 text-sm font-semibold text-fitx-text">{title}</p>
                <p className="mt-0.5 text-xs leading-5 text-fitx-text-secondary">{text}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-6 px-5 py-6 sm:px-8">
          {minor ? (
            <div className="rounded-lg border border-fitx-border bg-fitx-surface p-4 text-sm leading-6 text-fitx-text-secondary">
              <p className="font-semibold text-fitx-text">You&apos;re under 18</p>
              <p className="mt-1">The coach answers general questions only. It gets your questions, that you’re under 18 and the lowest daily calories it may suggest (FITX sets this from your sex), but not your logs or the rest of your profile. Please ask a parent or guardian before you use it. Meal and workout plans aren’t available for under-18 accounts.</p>
            </div>
          ) : (
            <fieldset>
              <legend className="text-sm font-semibold text-fitx-text">How should the coach work?</legend>
              <div className="mt-3 grid gap-3">
                <Choice checked={shareData} onSelect={() => setShareData(true)} title="Use my FITX data (recommended)" text="Personal answers, meal plans and workouts based on your real logs." />
                <Choice checked={!shareData} onSelect={() => setShareData(false)} title="Questions only" text="General answers, and plans are off. The coach gets your questions and the lowest daily calories it may suggest (FITX sets this from your sex), but not your logs or the rest of your profile." />
              </div>
            </fieldset>
          )}

          {!minor && shareData && sharedSummary.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-fitx-text">What the coach reads, as a short summary</h3>
              <ul className="mt-2 space-y-1.5 text-sm leading-6 text-fitx-text-secondary">
                {sharedSummary.map((line) => <li key={line} className="flex gap-2"><span aria-hidden="true" className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-fitx-text-disabled" />{line}</li>)}
              </ul>
            </div>
          )}

          <div className="flex gap-3 rounded-lg border border-fitx-success-border bg-fitx-success-bg p-4">
            <LockKeyhole size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-success" />
            <p className="text-sm leading-6 text-fitx-text">
              <span className="font-semibold">Never shared:</span> your name, email, photos, account ID or private notes. Your conversations are stored in your FITX account, and you can delete them at any time.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-fitx-text">Who answers</h3>
            <ul className="mt-2 space-y-2">
              {providers.map((provider) => (
                <li key={provider.id} className="rounded-lg border border-fitx-border px-3 py-2.5">
                  <p className="text-sm font-medium text-fitx-text">{provider.name}</p>
                  <p className="mt-0.5 text-xs leading-5 text-fitx-text-secondary">{provider.dataUse}</p>
                </li>
              ))}
            </ul>
          </div>

          <p className="flex gap-2 text-xs leading-5 text-fitx-text-secondary">
            <ShieldCheck size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            The coach gives general fitness and food guidance, not medical advice. With a medical condition, an injury, pregnancy or medication, check changes with your doctor.
          </p>

          {error && <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            <Link href="/dashboard" className="fitx-button fitx-button-quiet">Not now</Link>
            <button type="button" onClick={start} disabled={saving} className="fitx-button">{saving ? "Starting…" : "Start coaching"}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Choice({ checked, onSelect, title, text }: { checked: boolean; onSelect: () => void; title: string; text: string }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer gap-3 rounded-lg border p-3.5 transition-colors", checked ? "border-fitx-primary bg-fitx-primary/5" : "border-fitx-border hover:bg-fitx-hover")}>
      <input type="radio" name="coach-data-choice" checked={checked} onChange={onSelect} className="mt-1 h-4 w-4 shrink-0 accent-[var(--fitx-primary)]" />
      <span>
        <span className="block text-sm font-semibold text-fitx-text">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-fitx-text-secondary">{text}</span>
      </span>
    </label>
  );
}
