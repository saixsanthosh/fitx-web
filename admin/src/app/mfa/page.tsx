import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { signOut } from "@/app/signin/actions";
import { FitxMark } from "@/components/fitx-mark";
import { AuthenticatorCodeForm } from "@/components/mfa-forms";
import { requireAdminIdentity } from "@/lib/admin-auth";
import { ADMIN_MAX_SESSION_HOURS } from "@/lib/session-policy";

export const metadata: Metadata = { title: "Authenticator code" };

export default async function MfaPage() {
  const identity = await requireAdminIdentity();
  if (identity.mfa === "ok") redirect("/overview");
  if (identity.mfa === "enroll") redirect("/mfa/setup");

  return (
    <main className="access-page">
      <div className="access-card mfa-card">
        <span className="access-brand"><FitxMark size={34} /><span>FITX <em>ADMIN</em></span></span>
        <div className="access-icon access-icon-good"><ShieldCheck aria-hidden="true" size={25} /></div>
        <p className="eyebrow">Second step</p>
        <h1>Enter your authenticator code</h1>
        <p>Open the authenticator app you set up for FITX Admin and enter the six-digit code shown for <strong>{identity.email}</strong>.</p>
        <AuthenticatorCodeForm />
        <p className="mfa-note">Admin asks for a code once per sign-in, and sessions end {ADMIN_MAX_SESSION_HOURS} hours after you sign in with Google. Entering the code also signs this account out of the FITX app on every device. Lost your phone? Ask a super-admin to reset your authenticator on the Access screen.</p>
        <div className="access-actions">
          <form action={signOut}><button className="quiet-button" type="submit">Sign out</button></form>
        </div>
      </div>
    </main>
  );
}
