"use client";

import { useActionState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { setUpAuthenticator, verifyAuthenticatorCode, type CodeState, type SetupState } from "@/app/mfa/actions";

const codeMessages = {
  invalid_code: "That code was not accepted. Codes change every 30 seconds; enter the current one.",
  verify_failed: "The code could not be checked. Try again.",
  start_failed: "The authenticator set-up could not start. Try again in a moment.",
} as const;

function CodeField() {
  return (
    <label className="code-field">
      Six-digit code
      <input autoComplete="one-time-code" inputMode="numeric" maxLength={7} name="code" pattern="[0-9 ]{6,7}" placeholder="123456" required />
    </label>
  );
}

export function AuthenticatorSetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setUpAuthenticator, null);

  if (!state?.factorId) {
    return (
      <form action={action} className="mfa-form">
        <input type="hidden" name="intent" value="start" />
        {state?.error && <p role="alert" className="form-error">{codeMessages[state.error]}</p>}
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? <LoaderCircle aria-hidden="true" className="spin" size={17} /> : <KeyRound aria-hidden="true" size={17} />}
          <span>{pending ? "Preparing…" : "Set up an authenticator app"}</span>
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="mfa-form">
      <input type="hidden" name="intent" value="confirm" />
      <input type="hidden" name="factorId" value={state.factorId} />
      <ol className="mfa-steps">
        <li>Open an authenticator app, such as Google Authenticator, Microsoft Authenticator or 1Password.</li>
        <li>Scan this code, or type the key below into the app.</li>
      </ol>
      {state.qrCode && (
        // A Supabase-generated SVG data URL; next/image would add inline styles the CSP blocks.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="QR code for your authenticator app" className="mfa-qr" height={180} src={state.qrCode} width={180} />
      )}
      {state.secret && <p className="mfa-secret"><span>Key</span><code>{state.secret}</code></p>}
      <CodeField />
      {state.error && <p role="alert" className="form-error">{codeMessages[state.error]}</p>}
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? <LoaderCircle aria-hidden="true" className="spin" size={17} /> : null}
        <span>{pending ? "Checking…" : "Confirm and continue"}</span>
      </button>
    </form>
  );
}

export function AuthenticatorCodeForm() {
  const [state, action, pending] = useActionState<CodeState, FormData>(verifyAuthenticatorCode, null);
  return (
    <form action={action} className="mfa-form">
      <CodeField />
      {state?.error && <p role="alert" className="form-error">{codeMessages[state.error]}</p>}
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? <LoaderCircle aria-hidden="true" className="spin" size={17} /> : <KeyRound aria-hidden="true" size={17} />}
        <span>{pending ? "Checking…" : "Continue"}</span>
      </button>
    </form>
  );
}
