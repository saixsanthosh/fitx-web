"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { AMREntry, AuthChangeEvent, User } from "@supabase/supabase-js";
import { checkSession, signInHref } from "@/components/account/session-state";
import { PASSWORD_NOTE, signInMethods, type SignInMethods } from "@/components/account/sign-in-methods";
import { LogoutButton } from "@/components/app/LogoutButton";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { SettingsGroup, SettingsRow } from "./SettingsParts";

type Account = { email: string | null } & SignInMethods;
type View = { kind: "loading" } | { kind: "ready"; account: Account } | { kind: "signed_out" } | { kind: "failed" };

/**
 * How this session was signed in (the access token's amr claim, read locally): "password" there is the only proof the
 * account has a password. Unknown when it can't be read, which lists no password and keeps the note.
 */
async function sessionAmr(supabase: NonNullable<ReturnType<typeof createClient>>): Promise<AMREntry[]> {
  try {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return (data?.currentAuthenticationMethods ?? []) as AMREntry[];
  } catch {
    return [];
  }
}

function accountOf(user: User, amr: readonly AMREntry[]): Account {
  return { email: user.email ?? null, ...signInMethods({ identities: user.identities, appMetadata: user.app_metadata, amr }) };
}

/**
 * Account: e-mail, sign-in methods (named from the account and this session, sign-in-methods.ts), the Profile link,
 * and signing out here or everywhere. An ended session (signed out everywhere from another device, or this page shown
 * again by Back after Log out) says so and offers sign-in; only a check that really failed says the details could not
 * be loaded. The session is checked when the page mounts and again when Back or Forward brings it back from the
 * browser's back/forward cache.
 */
export function SettingsAccount({ profile }: { profile?: ReactNode }) {
  const [view, setView] = useState<View>(isSupabaseConfigured ? { kind: "loading" } : { kind: "failed" });

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let live = true;
    let ticket = 0;
    const check = async () => {
      const mine = ++ticket;
      const { state, user } = await checkSession<User>(() => supabase.auth.getUser());
      const amr = state === "signed_in" ? await sessionAmr(supabase) : [];
      if (!live || mine !== ticket) return;
      if (state === "signed_in" && user) setView({ kind: "ready", account: accountOf(user, amr) });
      else setView({ kind: state === "signed_out" ? "signed_out" : "failed" });
    };
    void check();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check();
    };
    window.addEventListener("pageshow", onPageShow);
    // Signed out in this browser meanwhile: another tab, or another check that found the session gone.
    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event !== "SIGNED_OUT" || !live) return;
      ticket += 1;
      setView({ kind: "signed_out" });
    });
    return () => {
      live = false;
      window.removeEventListener("pageshow", onPageShow);
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <SettingsGroup id="settings-account" title="Account">
      {view.kind === "ready" ? (
        <>
          <SettingsRow label="Email"><span className="break-all text-fitx-text">{view.account.email ?? "Not set"}</span></SettingsRow>
          <SettingsRow label="Sign-in methods" hint={view.account.passwordNote ? PASSWORD_NOTE : undefined}>
            <span className="flex flex-wrap gap-1.5 sm:justify-end">
              {view.account.methods.map((method) => <span key={method} className="rounded-full border border-fitx-border bg-fitx-surface-variant px-2.5 py-1 text-xs font-medium text-fitx-text">{method}</span>)}
            </span>
          </SettingsRow>
        </>
      ) : view.kind === "signed_out" ? (
        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p role="alert" className="m-0 text-sm text-fitx-text">You’re signed out. Sign in again to see your account.</p>
          <Link href={signInHref("/settings")} className="fitx-button min-h-11 shrink-0 self-start px-4 text-sm sm:self-auto">Sign in</Link>
        </div>
      ) : (
        <p className="m-0 py-4 text-sm text-fitx-text-secondary" role={view.kind === "failed" ? "alert" : "status"}>
          {view.kind === "failed" ? "Your account details could not be loaded. Reload to try again." : "Loading your account…"}
        </p>
      )}
      {profile}
      {/* Nothing to sign out of once the session has ended. */}
      {view.kind !== "signed_out" && (
        <div className="flex flex-wrap items-center gap-x-6 py-2">
          <LogoutButton />
          <LogoutButton scope="global" />
        </div>
      )}
    </SettingsGroup>
  );
}
