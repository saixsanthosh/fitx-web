"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { IntroReplayControl } from "@/components/brand/IntroReplayControl";
import { saveAccountTheme } from "@/components/ui/accountTheme";
import { applyTheme, useThemeMode, type ThemeMode } from "@/components/ui/theme";

const OPTIONS: { value: ThemeMode; label: string; hint: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", hint: "Always light", icon: Sun },
  { value: "dark", label: "Dark", hint: "Always dark", icon: Moon },
  { value: "system", label: "Match device", hint: "Follows your phone or computer", icon: Monitor },
];

const MESSAGES = {
  saving: "Saving…",
  saved: "Saved. Your other devices will use it too.",
  "signed-out": "Saved on this device.",
  "not-available": "Saved on this device. It will sync to your account after the next FITX update.",
  failed: "Saved on this device. We couldn’t reach your account, so we’ll try again next time you open FITX.",
} as const;

/** Theme choice: shown at once, kept on this device and saved to the account. */
export function SettingsAppearance() {
  const mode = useThemeMode();
  const [message, setMessage] = useState("");

  async function choose(next: ThemeMode) {
    if (next === mode) return;
    applyTheme(next);
    setMessage(MESSAGES.saving);
    const result = await saveAccountTheme(next);
    // A newer choice was made while this one saved; its own result will show.
    if (result.stale) return;
    setMessage(result.saved ? MESSAGES.saved : MESSAGES[result.reason]);
  }

  return (
    <section className="fitx-panel p-5" aria-labelledby="settings-appearance">
      <h2 id="settings-appearance" className="text-base font-semibold text-fitx-text">Appearance</h2>
      <fieldset className="mt-4">
        <legend className="text-sm text-fitx-text-secondary">Theme</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {OPTIONS.map(({ value, label, hint, icon: Icon }) => (
            <label key={value} className="fitx-choice">
              <input type="radio" name="fitx-theme" value={value} checked={mode === value} onChange={() => void choose(value)} />
              <span className="fitx-choice__box">
                <Icon size={18} aria-hidden="true" className="fitx-choice__icon" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-fitx-text">{label}</span>
                  <span className="block text-xs text-fitx-text-secondary">{hint}</span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-xs text-fitx-text-secondary">{message}</p>
      <div className="mt-3 border-t border-fitx-divider pt-4">
        <p className="text-sm text-fitx-text-secondary">Watch the FITX intro film again.</p>
        <IntroReplayControl className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-fitx-primary-text underline-offset-4 hover:underline" />
      </div>
    </section>
  );
}
