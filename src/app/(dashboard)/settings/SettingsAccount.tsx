"use client";

import { useEffect, useState } from "react";
import type { UserIdentity, UserResponse } from "@supabase/supabase-js";
import { LogoutButton } from "@/components/app/LogoutButton";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Account = { email: string | null; methods: string[] };

const METHOD_NAMES: Record<string, string> = { google: "Google", email: "Email and password", apple: "Apple" };

export function SettingsAccount() {
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
    <section className="fitx-panel p-5" aria-labelledby="settings-account">
      <h2 id="settings-account" className="text-base font-semibold text-fitx-text">Account</h2>
      {account ? (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[9rem_1fr]">
          <dt className="text-fitx-text-secondary">Email</dt>
          <dd className="break-all text-fitx-text">{account.email ?? "Not set"}</dd>
          <dt className="text-fitx-text-secondary">Signs in with</dt>
          <dd className="text-fitx-text">{account.methods.join(", ")}</dd>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-fitx-text-secondary" role={failed ? "alert" : "status"}>
          {failed ? "We couldn’t load your account details. Check your connection and reload." : "Loading your account…"}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-2 border-t border-fitx-divider pt-4">
        <LogoutButton />
        <LogoutButton scope="global" />
      </div>
      <p className="mt-2 text-xs leading-5 text-fitx-text-secondary">“Log out” signs out this device only. “Sign out of all devices” also ends FITX sessions on your other phones and computers.</p>
    </section>
  );
}
