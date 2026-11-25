/**
 * Signing in with a one-time code sent by e-mail (Supabase `signInWithOtp` then `verifyOtp` with type "email").
 * Free on every Supabase plan. The hosted project's e-mail templates must include {{ .Token }} for the code to
 * reach the member: "Magic link" for an existing account and "Confirm signup" for a new address (sign-up uses
 * shouldCreateUser). With only {{ .ConfirmationURL }} they send a link, which the code screen also accepts.
 * The project's Email OTP length must stay 6 (CODE_LENGTH). Owner steps: docs/runbooks/platform-database.md,
 * section 7 ("Email code sign-in").
 *
 * Pure helpers only, shared by the sign-in and sign-up pages and their tests. A suspended account (Supabase's
 * user_banned, set by FITX Admin) is told so wherever sign-in fails.
 */

import { isSuspendedError, SUSPENDED_MESSAGE } from "@/lib/platform/account-status";

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

type AuthErrorLike = { code?: string | null; status?: number | null; message?: string | null; reasons?: unknown } | null | undefined;

export type SendCodeProblem = { message: string; retryAfter: number | null };

/** What to tell someone whose code request failed, and how long to wait when Supabase said so. */
export function sendCodeProblem(error: AuthErrorLike): SendCodeProblem {
  if (isSuspendedError(error)) return { message: SUSPENDED_MESSAGE, retryAfter: null };
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
    return { message: "Email codes aren’t available right now. Use Google or your password.", retryAfter: null };
  }
  if (code === "email_provider_disabled" || /email logins are disabled|provider is not enabled/i.test(message)) {
    return { message: "Email codes are turned off for FITX right now. Use Google.", retryAfter: null };
  }
  return { message: "We couldn’t send a code. Please try again.", retryAfter: null };
}

/** What to tell someone whose code did not verify. */
export function verifyCodeProblem(error: AuthErrorLike): string {
  if (isSuspendedError(error)) return SUSPENDED_MESSAGE;
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

/** What to tell someone whose email and password sign-in failed. */
export function passwordSignInProblem(error: AuthErrorLike): string {
  if (isSuspendedError(error)) return SUSPENDED_MESSAGE;
  const message = error?.message ?? "";
  if (/email not confirmed/i.test(message)) return "Confirm your email address first, or sign in with a code.";
  if (/invalid login credentials/i.test(message)) return "That email and password don’t match. Try again, or use a code.";
  return "We couldn’t sign you in. Please try again.";
}

export type SignUpProblem = {
  message: string;
  /** The field the problem is about (shown under it), or null for the form's own message under its button. */
  field: "email" | "password" | null;
  /** The address already has an account: the page offers sign-in and a password reset beside the message. */
  existingAccount: boolean;
};

/**
 * What to tell someone whose sign-up with a password was refused (bug 43): what happened and what to do next, never a
 * "check your details" that a retry can't fix. An address that already has an account (Supabase answers 422
 * user_already_exists where it confirms addresses itself) is told it may have one, with sign-in and a reset beside it;
 * where Supabase sends confirmation emails it reveals nothing, and the "Check your email" view says the same for
 * everyone (SignUpForm), so the page never tells more than Supabase's own answer does.
 */
export function signUpProblem(error: AuthErrorLike): SignUpProblem {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  const plain = (text: string, field: SignUpProblem["field"] = null): SignUpProblem => ({ message: text, field, existingAccount: false });
  if (isSuspendedError(error)) return plain(SUSPENDED_MESSAGE);
  if (code === "user_already_exists" || code === "email_exists" || /already (been )?registered|already exists/i.test(message)) {
    return { message: "That email may already have a FITX account.", field: null, existingAccount: true };
  }
  if (code === "weak_password" || /weak password|password should/i.test(message)) {
    const reasons: unknown[] = Array.isArray(error?.reasons) ? (error?.reasons as unknown[]) : [];
    if (reasons.includes("pwned")) return plain("That password has appeared in a data breach elsewhere. Choose a different one.", "password");
    if (reasons.includes("characters")) return plain("Choose a stronger password, with a mix of letters, numbers and symbols.", "password");
    return plain("Choose a longer password.", "password");
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error?.status === 429 || /rate limit|too many/i.test(message)) {
    return plain("Too many sign-up attempts. Wait a few minutes, then try again.");
  }
  if (code === "email_address_invalid" || code === "validation_failed" || /invalid format|email address.*invalid/i.test(message)) {
    return plain("Check the email address and try again.", "email");
  }
  if (code === "signup_disabled" || /signups? not allowed/i.test(message)) return plain("New accounts can’t be created right now. Please try again later.");
  if (code === "email_provider_disabled" || /email (logins|signups) are disabled|provider is not enabled/i.test(message)) {
    return plain("Email sign-up is turned off for FITX right now. Use Google.");
  }
  return plain("We couldn’t create your account. Please try again.");
}
