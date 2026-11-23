"use client";

import { useEffect, useState } from "react";
import { cachedLauncherPref, loadLauncherPref, saveLauncherPref, type LauncherPrefSave } from "@/lib/shell/coach-launcher-pref";
import { useHydrated } from "@/components/ui/use-hydrated";
import { SettingsRow } from "./SettingsParts";

const MESSAGES: Record<"saving" | "saved" | Exclude<LauncherPrefSave, { saved: true }>["reason"], string> = {
  saving: "Saving…",
  saved: "Saved to your account.",
  "signed-out": "Saved on this device.",
  "not-available": "Saved on this device only for now. It will follow your account after the next FITX update.",
  failed: "Saved on this device. We couldn’t reach your account, so try again later.",
};

/**
 * The switch "Floating AI Coach button": off hides the button for good (after a refresh, a new sign-in or on
 * another device) until it is turned back on here. Hiding it from the button itself lasts one page load only.
 */
export function SettingsCoachLauncher() {
  const hydrated = useHydrated();
  // The account's answer once known (or the member's own change); until then this device's cached choice.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const on = chosen ?? (hydrated ? cachedLauncherPref() : true);
  const [deviceOnly, setDeviceOnly] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let live = true;
    void loadLauncherPref().then((result) => {
      if (!live) return;
      setChosen((current) => current ?? result.on);
      setDeviceOnly(result.where === "device");
    });
    return () => {
      live = false;
    };
  }, []);

  async function toggle() {
    const next = !on;
    setChosen(next);
    setMessage(MESSAGES.saving);
    const result = await saveLauncherPref(next);
    setDeviceOnly(!result.saved);
    setMessage(result.saved ? MESSAGES.saved : MESSAGES[result.reason]);
  }

  return (
    <SettingsRow
      label="Floating AI Coach button"
      hint={deviceOnly && !message ? "Applies on this device only for now." : "Opens the coach from any page. Drag it where you like."}
    >
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Floating AI Coach button"
          onClick={() => void toggle()}
          className="fitx-switch"
        >
          <span className="fitx-switch__thumb" aria-hidden="true" />
        </button>
        <p role="status" aria-live="polite" className="m-0 max-w-[260px] text-xs leading-5 text-fitx-text-secondary empty:hidden">{message}</p>
      </div>
    </SettingsRow>
  );
}
