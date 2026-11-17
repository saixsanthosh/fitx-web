"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocksLike } from "@/lib/activity/device-recordings";
import { recordingStore } from "@/lib/activity/local-store";
import type { DeviceActivityAtSignOut } from "@/lib/activity/sign-out";
import { AUTH_HINT_COOKIE, SESSION_COOKIE_RE } from "@/lib/auth/cookies";
import { createClient } from "@/lib/supabase/client";

type Scope = "local" | "global";

/**
 * Signs out this device ("local", the default) or every device ("global"). A failed sign-out says so
 * and leaves the user where they are, instead of quietly bouncing back into the app.
 * Activity recordings this device keeps for the account (GPS tracks) are uploaded first and removed
 * from the device once signed out; if some can't be saved to the account, it asks before deleting them.
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
    const activity = await deviceActivity(supabase);
    if (activity && activity.notUploaded > 0 && !window.confirm(notUploadedQuestion(activity.notUploaded))) {
      setBusy(false);
      return;
    }
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope });
      if (signOutError) throw signOutError;
    } catch {
      if (everywhere) {
        setBusy(false);
        setError("We couldn’t sign out your devices. Check your connection and try again.");
        return;
      }
      // Supabase unreachable: still end the session on this device (its cookies are readable here).
      for (const part of document.cookie.split(";")) {
        const name = part.split("=")[0]?.trim();
        if (name && SESSION_COOKIE_RE.test(name)) document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
      }
    }
    await activity?.clear();
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

function notUploadedQuestion(count: number) {
  return count === 1
    ? "1 activity on this device isn’t saved to your account yet. Sign out and delete it from this device?"
    : `${count} activities on this device aren’t saved to your account yet. Sign out and delete them from this device?`;
}

/** This account's activity recordings on this device, uploaded where possible; null when the browser keeps none for it. */
async function deviceActivity(supabase: SupabaseClient): Promise<DeviceActivityAtSignOut | null> {
  try {
    const userId = (await supabase.auth.getSession()).data.session?.user.id;
    if (!userId) return null;
    const store = await recordingStore();
    try {
      // The upload code (the GPS engine included) loads only when someone signs out, not with every page.
      const { prepareDeviceActivityForSignOut } = await import("@/lib/activity/sign-out");
      const locks = (navigator as Navigator & { locks?: LocksLike }).locks ?? null;
      return await prepareDeviceActivityForSignOut(store, supabase, userId, { locks });
    } catch {
      // It couldn't load (offline): nothing can be uploaded, but what this device holds is still counted and removed.
      const notUploaded = (await store.listRecordings(userId)).length;
      return { notUploaded, clear: () => store.deleteAll(userId).then(() => store.deleteOrphanEntries()).catch(() => undefined) };
    }
  } catch {
    // No IndexedDB here (private mode, blocked storage): nothing was kept on this device.
    return null;
  }
}
