"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Dumbbell, LockKeyhole, MessageCircle, ShieldCheck, Utensils } from "lucide-react";
import type { ProviderNotice } from "@/lib/ai/status";
import { cn } from "@/lib/utils";
import { CoachRequestError, saveConsent } from "./coach-client";

/**
 * The first screen of the coach: what it does, exactly what it would share and with whom, and a
 * real choice that starts unmade: nothing is shared unless the member picks "Use my FITX data".
 * Nothing is sent anywhere until the member presses "Start coaching".
 */
export function ConsentPanel({
  providers,
  sharedSummary,
  minor,
  ageMissing,
  memberDataAvailable,
  focusKey = 0,
  onDone,
}: {
  providers: ProviderNotice[];
  sharedSummary: string[];
  minor: boolean;
  /** No age in the profile: "Use my FITX data" waits for one (the server refuses it too). */
  ageMissing: boolean;
  memberDataAvailable: boolean;
  /**
   * A new key moves focus to the heading: the screen replaced the coach (after "Delete my coach data", or when a reply
   * found the consent gone), so focus starts there, not on the page body. 0 (on load) leaves focus alone.
   */
  focusKey?: number;
  onDone: (shareData: boolean) => void;
}) {
  // null until the member chooses; under-18 accounts never share.
  const [shareData, setShareData] = useState<boolean | null>(minor ? false : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const chosen = minor || shareData !== null;
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusKey) heading.current?.focus();
  }, [focusKey]);

  async function start() {
    // Start coaching stays focusable while saving (aria-disabled), so a refusal's message is read with focus kept.
    if (!chosen || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await saveConsent(shareData === true && !minor);
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
          <h2 ref={heading} tabIndex={-1} id="coach-consent-title" className="mt-2 text-[24px] font-bold leading-tight tracking-[-.03em] text-fitx-text sm:text-[28px]">Coaching built on your own numbers</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-fitx-text-secondary">
            Free AI services answer. FITX checks every food against its nutrition data and every exercise against its library.
          </p>
          <ul className="mt-5 grid gap-x-5 gap-y-3 sm:grid-cols-3">
            {[
              { icon: MessageCircle, title: "Ask anything", text: "Training, food and recovery questions" },
              { icon: Utensils, title: "Meal plans", text: minor ? "Not available under 18" : ageMissing ? "Need your age in Profile first" : "Planned around your diet, allergies and budget. Check labels too" },
              { icon: Dumbbell, title: "Workouts", text: minor ? "Not available under 18" : ageMissing ? "Need your age in Profile first" : "Only exercises you can do with your kit" },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3 sm:block">
                <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-primary" />
                <span className="block sm:mt-2">
                  <span className="block text-sm font-semibold text-fitx-text">{title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-fitx-text-secondary">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-6 px-5 py-6 sm:px-8">
          {minor ? (
            <div className="rounded-lg border border-fitx-border bg-fitx-surface p-4 text-sm leading-6 text-fitx-text-secondary">
              <p className="font-semibold text-fitx-text">You&apos;re under 18</p>
              <p className="mt-1">The coach answers general questions only. It gets your questions with the recent messages of that conversation, that you’re under 18 and the lowest daily calories it may suggest (FITX sets this from your sex), but not your logs or the rest of your profile. For 30 days after FITX shows its eating-disorder support note, it’s also told that you recently shared something that can be a sign of an eating disorder. Please ask a parent or guardian before you use it. Meal and workout plans aren’t available for under-18 accounts.</p>
            </div>
          ) : (
            <fieldset>
              <legend className="text-sm font-semibold text-fitx-text">How should the coach work?</legend>
              <div className="mt-3 grid gap-3">
                <Choice
                  checked={shareData === true}
                  onSelect={() => setShareData(true)}
                  disabled={!memberDataAvailable || ageMissing}
                  title="Use my FITX data"
                  text={
                    ageMissing
                      ? "Add your age in Profile first: FITX shares your data with the coach only for accounts of people 18 or over."
                      : memberDataAvailable
                        ? "Personal answers, meal plans and workouts based on your real logs."
                        : "Not switched on yet: FITX sends your data only to AI services that don't let people read it, and none is connected yet."
                  }
                />
                <Choice
                  checked={shareData === false}
                  onSelect={() => setShareData(false)}
                  title="Questions only"
                  text="General answers, and plans are off. The coach gets your questions with the recent messages of that conversation, and the lowest daily calories it may suggest (FITX sets this from your sex), but not your logs or the rest of your profile. For 30 days after FITX shows its eating-disorder support note, it’s also told that you recently shared something that can be a sign of an eating disorder."
                />
              </div>
            </fieldset>
          )}

          {!minor && !ageMissing && memberDataAvailable && shareData !== false && sharedSummary.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-fitx-text">What “Use my FITX data” lets the coach read, as a short summary</h3>
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
            {!chosen && <p id="coach-consent-choose" className="text-sm text-fitx-text-secondary sm:mr-auto">Choose how the coach should work to start.</p>}
            <Link href="/dashboard" className="fitx-button fitx-button-quiet">Not now</Link>
            <button type="button" onClick={start} disabled={!chosen} aria-disabled={saving || undefined} aria-describedby={chosen ? undefined : "coach-consent-choose"} className="fitx-button aria-disabled:opacity-60">
              {saving ? "Starting…" : "Start coaching"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Choice({ checked, onSelect, title, text, disabled = false }: { checked: boolean; onSelect: () => void; title: string; text: string; disabled?: boolean }) {
  return (
    <label
      className={cn(
        "flex min-h-11 gap-3 rounded-lg border p-3.5 transition-colors",
        disabled ? "cursor-not-allowed border-fitx-border opacity-70" : "cursor-pointer",
        !disabled && (checked ? "border-fitx-primary bg-fitx-primary/5" : "border-fitx-border hover:bg-fitx-hover"),
      )}
    >
      <input type="radio" name="coach-data-choice" checked={checked} disabled={disabled} onChange={onSelect} className="mt-1 h-4 w-4 shrink-0 accent-[var(--fitx-primary)]" />
      <span>
        <span className="block text-sm font-semibold text-fitx-text">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-fitx-text-secondary">{text}</span>
      </span>
    </label>
  );
}
