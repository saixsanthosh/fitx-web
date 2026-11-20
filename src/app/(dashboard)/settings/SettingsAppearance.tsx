"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { IntroReplayControl } from "@/components/brand/IntroReplayControl";
import { saveAccountTheme } from "@/components/ui/accountTheme";
import { applyTheme, useThemeMode, type ThemeMode } from "@/components/ui/theme";
import { SettingsGroup, SettingsRow } from "./SettingsParts";

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match device", icon: Monitor },
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
    <SettingsGroup id="settings-appearance" title="Appearance">
      {/* The three options fill the card edge to edge; the status line takes room only once there is something to say. */}
      <div className="py-4">
      <fieldset>
        <legend className="text-sm font-medium text-fitx-text">Theme</legend>
        <div className="mt-3 grid grid-cols-3 items-stretch gap-2 sm:gap-3">
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <label key={value} className="fitx-choice h-full">
              <input type="radio" name="fitx-theme" value={value} checked={mode === value} onChange={() => void choose(value)} />
              <span className="fitx-choice__box h-full min-h-[76px] flex-col justify-center gap-1.5 px-2 text-center">
                <Icon size={20} aria-hidden="true" className="fitx-choice__icon" />
                <span className="block text-[13px] font-semibold leading-tight text-fitx-text">{label}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p role="status" aria-live="polite" className="m-0 mt-2 text-xs leading-5 text-fitx-text-secondary empty:mt-0">{message}</p>
      </div>
      <SettingsRow label="Intro film">
        <IntroReplayControl className="inline-flex min-h-11 items-center rounded-full border border-fitx-border px-4 text-sm font-semibold text-fitx-text transition-colors hover:bg-fitx-hover motion-reduce:transition-none" />
      </SettingsRow>
    </SettingsGroup>
  );
}
