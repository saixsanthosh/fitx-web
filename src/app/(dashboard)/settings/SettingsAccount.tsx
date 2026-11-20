"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { UserIdentity, UserResponse } from "@supabase/supabase-js";
import { LogoutButton } from "@/components/app/LogoutButton";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { SettingsGroup, SettingsRow } from "./SettingsParts";

type Account = { email: string | null; methods: string[] };

const METHOD_NAMES: Record<string, string> = { google: "Google", email: "Email and password", apple: "Apple" };

/** Account: e-mail, sign-in methods, the Profile link, and signing out here or everywhere. */
export function SettingsAccount({ profile }: { profile?: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [failed, setFailed] = useState(!isSupabaseConfigured);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let live = true;
    supabase.auth.getUser().then(({ data, error }: UserResponse) => {
      if (!live) return;
      if (error || !data.user) return setFailed(true);
      const providers: string[] = (data.user.identities ?? []).map((identity: UserIdentity) => identity.provider);
      const methods = [...new Set(providers.length ? providers : [String(data.user.app_metadata?.provider ?? "email")])];
      setAccount({ email: data.user.email ?? null, methods: methods.map((method) => METHOD_NAMES[method] ?? method) });
    }, () => live && setFailed(true));
    return () => { live = false; };
  }, []);

  return (
    <SettingsGroup id="settings-account" title="Account">
      {account ? (
        <>
          <SettingsRow label="Email"><span className="break-all text-fitx-text">{account.email ?? "Not set"}</span></SettingsRow>
          <SettingsRow label="Sign-in methods">
            <span className="flex flex-wrap gap-1.5 sm:justify-end">
              {account.methods.map((method) => <span key={method} className="rounded-full border border-fitx-border bg-fitx-surface-variant px-2.5 py-1 text-xs font-medium text-fitx-text">{method}</span>)}
            </span>
          </SettingsRow>
        </>
      ) : (
        <p className="m-0 py-4 text-sm text-fitx-text-secondary" role={failed ? "alert" : "status"}>
          {failed ? "Your account details could not be loaded. Reload to try again." : "Loading your account…"}
        </p>
      )}
      {profile}
      <div className="flex flex-wrap items-center gap-x-6 py-2">
        <LogoutButton />
        <LogoutButton scope="global" />
      </div>
    </SettingsGroup>
  );
}
