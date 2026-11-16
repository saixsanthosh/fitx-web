import type { Metadata } from "next";
import { FitxMark } from "@/components/fitx-mark";
import { SignInForm } from "@/components/sign-in-form";
import type { SignInError } from "@/app/signin/actions";

export const metadata: Metadata = { title: "Sign in" };

const knownErrors = ["invalid_email", "not_authorized", "setup_pending", "configuration", "service_key_missing", "oauth", "session_expired"] as const satisfies readonly SignInError[];

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const initialError = knownErrors.includes(params.error as SignInError) ? params.error as SignInError : undefined;

  return (
    <main className="signin-page">
      <section className="signin-story" aria-labelledby="signin-title">
        <div className="signin-brand">
          <FitxMark size={40} className="signin-mark" />
          <span>FITX <em>ADMIN</em></span>
        </div>
        <div className="story-copy">
          <p className="eyebrow">Platform operations</p>
          <h1 id="signin-title">A clearer view of the work behind every rep.</h1>
          <p>One private workspace for the people keeping FITX moving.</p>
        </div>
        <div className="story-foot"><span>TRAIN SMART. LIVE FIT.</span><span>INTERNAL ACCESS</span></div>
        <div className="story-shape" aria-hidden="true"><span /><span /><span /></div>
      </section>

      <section className="signin-panel" aria-labelledby="access-heading">
        <div className="signin-panel-inner">
          <div className="mobile-signin-brand"><FitxMark size={30} className="signin-mark" /><span>FITX <em>ADMIN</em></span></div>
          <p className="eyebrow">Secure administrator access</p>
          <h2 id="access-heading">Sign in to continue</h2>
          <p className="signin-intro">Use the Google account already approved for FITX operations.</p>
          <SignInForm initialError={initialError} />
          <p className="signin-help">Admin access is granted by the FITX owner. There is no public Admin registration.</p>
        </div>
        <footer className="signin-footer">Private workspace <span aria-hidden="true">·</span> FITX</footer>
      </section>
    </main>
  );
}
