"use client";

import { useActionState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { beginGoogleSignIn, type SignInError } from "@/app/signin/actions";

const messages: Record<SignInError, string> = {
  invalid_email: "Enter a valid work email address.",
  not_authorized: "This account is not on the owner-managed Admin sign-in allowlist.",
  setup_pending: "Admin access is not initialized yet. The owner must approve the setup first.",
  configuration: "Admin sign-in is not configured on this environment yet.",
  oauth: "Google sign-in could not start. Please try again.",
};

export function SignInForm({ initialError }: { initialError?: keyof typeof messages }) {
  const [state, action, pending] = useActionState(beginGoogleSignIn, initialError ? { error: initialError } : null);

  return (
    <form action={action} className="signin-form">
      <label htmlFor="admin-email">Work email</label>
      <input
        autoComplete="email"
        id="admin-email"
        name="email"
        placeholder="name@company.com"
        required
        type="email"
      />
      <p className="field-note">Only an already provisioned FITX administrator can continue.</p>
      {state?.error && <p role="alert" className="form-error">{messages[state.error]}</p>}
      <button className="google-button" disabled={pending} type="submit">
        {pending ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : <GoogleGlyph />}
        <span>{pending ? "Checking access…" : "Continue with Google"}</span>
        {!pending && <ArrowRight aria-hidden="true" className="button-arrow" size={18} />}
      </button>
      <p className="signin-assurance">Your Google account is checked against FITX Admin roles before sign-in.</p>
    </form>
  );
}

function GoogleGlyph() {
  return (
    <svg aria-hidden="true" className="google-glyph" viewBox="0 0 48 48" focusable="false">
      <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.8 6-15Z" />
      <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.7-5.1c-1.8 1.2-4 1.9-6.8 1.9-5.2 0-9.6-3.5-11.2-8.2H5.9v5.3A20 20 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.8 27.7a12 12 0 0 1 0-7.4V15H5.9a20 20 0 0 0 0 17.9l6.9-5.2Z" />
      <path fill="#EA4335" d="M24 12.1c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6.1 29.5 4 24 4A20 20 0 0 0 5.9 15l6.9 5.3c1.6-4.7 6-8.2 11.2-8.2Z" />
    </svg>
  );
}
