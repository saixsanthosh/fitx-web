"use client";

const CONSENT_KEY = "fitx-cookie-consent";

export function CookiePreferences() {
  function save(value: "all" | "essential") {
    try {
      window.localStorage.setItem(CONSENT_KEY, value);
      window.dispatchEvent(new Event("fitx-cookie-consent-change"));
    } catch {
      // Essential application storage remains available when local storage is blocked.
    }
  }

  return <div className="rounded-lg border border-fitx-border bg-fitx-surface p-4">
    <p className="text-sm font-medium">Change your analytics choice</p>
    <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">This setting takes effect on this browser. Essential sign-in storage is always active.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={() => save("essential")} className="fitx-button fitx-button-quiet px-4 text-sm">Essential only</button>
      <button type="button" onClick={() => save("all")} className="fitx-button px-4 text-sm">Allow analytics</button>
    </div>
  </div>;
}
