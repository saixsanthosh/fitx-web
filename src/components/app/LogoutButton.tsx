"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    const supabase = createClient();
    if (!supabase) return;
    setBusy(true);
    await supabase.auth.signOut();
    window.location.assign("/signin");
  }
  return <button type="button" disabled={busy} onClick={() => void logout()} className={`inline-flex items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text disabled:opacity-50 ${className}`}><LogOut size={16} />{busy ? "Signing out…" : "Log out"}</button>;
}
