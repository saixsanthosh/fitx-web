/**
 * Signing in with a one-time code sent by e-mail (Supabase `signInWithOtp` then `verifyOtp` with type "email").
 * Free on every Supabase plan. The hosted project's e-mail templates must include {{ .Token }} for the code to
 * reach the member: "Magic link" for an existing account and "Confirm signup" for a new address (sign-up uses
 * shouldCreateUser). With only {{ .ConfirmationURL }} they send a link, which the code screen also accepts.
 * The project's Email OTP length must stay 6 (CODE_LENGTH). Owner steps: docs/runbooks/platform-database.md,
 * section 7 ("Email code sign-in").
 *
 * Pure helpers only, shared by the sign-in and sign-up pages and their tests.
 */

export const CODE_LENGTH = 6;

/** Supabase lets an address ask for a new code once a minute (Auth → Rate limits). */
export const RESEND_SECONDS = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * The digits of whatever was typed or pasted, at most six: "123 456", "123-456" and "Your code is 123456"
 * all become "123456". Letters and spaces are dropped, never turned into digits.
 */
export function normaliseCode(input: string): string {
  return input.replace(/\D+/g, "").slice(0, CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return code.length === CODE_LENGTH && /^\d+$/.test(code);
}

/** "For security purposes, you can only request this after 37 seconds." → 37. */
export function retryAfterSeconds(message: string | null | undefined): number | null {
  const match = /after (\d{1,4}) seconds?/i.exec(message ?? "");
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : null;
}

/** "0:42" for 42 seconds, "1:00" for 60. */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

type AuthErrorLike = { code?: string | null; status?: number | null; message?: string | null } | null | undefined;

export type SendCodeProblem = { message: string; retryAfter: number | null };

/** What to tell someone whose code request failed, and how long to wait when Supabase said so. */
export function sendCodeProblem(error: AuthErrorLike): SendCodeProblem {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  const retryAfter = retryAfterSeconds(message);
  if (retryAfter !== null || code === "over_email_send_rate_limit" || /rate limit|too many/i.test(message) || error?.status === 429) {
    return {
      message: retryAfter !== null ? "A code was sent a moment ago. Wait, then ask for another." : "Too many codes asked for. Try again in a few minutes.",
      retryAfter,
    };
  }
  if (code === "email_address_invalid" || code === "validation_failed" || /invalid format|email address.*invalid/i.test(message)) {
    return { message: "Check the email address and try again.", retryAfter: null };
  }
  if (code === "otp_disabled" || code === "signup_disabled" || /signups? not allowed/i.test(message)) {
    return { message: "Email codes are not available for this address. Use Google or your password.", retryAfter: null };
  }
  if (code === "email_provider_disabled" || /email logins are disabled|provider is not enabled/i.test(message)) {
    return { message: "Email codes are turned off for FITX right now. Use Google.", retryAfter: null };
  }
  return { message: "We couldn’t send a code. Please try again.", retryAfter: null };
}

/** What to tell someone whose code did not verify. */
export function verifyCodeProblem(error: AuthErrorLike): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (error?.status === 429 || code === "over_request_rate_limit" || /rate limit|too many/i.test(message)) {
    return "Too many tries. Wait a few minutes, then send a new code.";
  }
  if (code === "otp_expired" || /expired|invalid/i.test(message)) {
    return "That code is wrong or has expired. Check it, or send a new one.";
  }
  return "We couldn’t check that code. Please try again.";
}
