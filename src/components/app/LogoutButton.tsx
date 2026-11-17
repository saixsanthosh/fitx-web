"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { AUTH_HINT_COOKIE } from "@/lib/auth/cookies";
import { signOutWithDeviceActivity } from "@/lib/auth/device-sign-out";
import { createClient } from "@/lib/supabase/client";

type Scope = "local" | "global";

/**
 * Signs out this device ("local", the default) or every device ("global"). A failed sign-out says so
 * and leaves the user where they are, instead of quietly bouncing back into the app.
 * Activity recordings this device keeps for the account (GPS tracks) are uploaded first and removed
 * from the device once signed out; if some can't be saved to the account, it asks before deleting them
 * (see src/lib/auth/device-sign-out.ts).
 */
export function LogoutButton({ className = "", scope = "local", label }: { className?: string; scope?: Scope; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const everywhere = scope === "global";

  async function logout() {
    setError("");
    if (everywhere && !window.confirm("Sign out of FITX on every device, including this one?")) return;
    const supabase = createClient();
    if (!supabase) {
      setError("Signing out isn’t available right now. Please try again in a moment.");
      return;
    }
    setBusy(true);
    const outcome = await signOutWithDeviceActivity(supabase, { scope, ask: (question) => window.confirm(question) });
    if (outcome === "cancelled") {
      setBusy(false);
      return;
    }
    if (outcome === "failed") {
      setBusy(false);
      setError("We couldn’t sign out your devices. Check your connection and try again.");
      return;
    }
    document.cookie = `${AUTH_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
    window.location.replace("/signin?signed_out=1");
  }

  const text = label ?? (everywhere ? "Sign out of all devices" : "Log out");
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void logout()}
        className={`inline-flex min-h-11 items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text disabled:opacity-50 ${className}`}
      >
        <LogOut size={16} aria-hidden="true" />{busy ? "Signing out…" : text}
      </button>
      {error && <span role="alert" className="text-xs text-fitx-primary">{error}</span>}
    </span>
  );
}
