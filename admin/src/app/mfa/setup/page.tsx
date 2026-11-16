import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { signOut } from "@/app/signin/actions";
import { FitxMark } from "@/components/fitx-mark";
import { AuthenticatorSetupForm } from "@/components/mfa-forms";
import { requireAdminIdentity } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Set up an authenticator" };

export default async function MfaSetupPage() {
  const identity = await requireAdminIdentity();
  if (identity.mfa === "ok") redirect("/overview");
  if (identity.mfa === "verify") redirect("/mfa");

  return (
    <main className="access-page">
      <div className="access-card mfa-card">
        <span className="access-brand"><FitxMark size={34} /><span>FITX <em>ADMIN</em></span></span>
        <div className="access-icon access-icon-good"><KeyRound aria-hidden="true" size={25} /></div>
        <p className="eyebrow">One-time set-up</p>
        <h1>Protect Admin with an authenticator app</h1>
        <p>Every FITX Admin account needs a second step at sign-in. Set up an authenticator app for <strong>{identity.email}</strong> on your phone; it takes about a minute.</p>
        <AuthenticatorSetupForm />
        <p className="mfa-note">This only applies to FITX Admin. Signing in to the FITX app is unchanged.</p>
        <div className="access-actions">
          <form action={signOut}><button className="quiet-button" type="submit">Sign out</button></form>
        </div>
      </div>
    </main>
  );
}
