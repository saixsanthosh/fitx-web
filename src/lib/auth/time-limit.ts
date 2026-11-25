/**
 * Time limits for the sign-in pages' requests (Supabase Auth, and FITX's own sign-in finish). Without one, a request
 * that never answers (a stalled connection, a captive portal, a server that hangs) left the form on "Sending code…"
 * or "Signing in…" for ever, with every button disabled. Now the form stops waiting, says so plainly, and its button
 * works again. Supabase's client cannot cancel its requests, so a late answer can still arrive: each form says what
 * then happens, and its `late` handler does it (a code or link sent late counts for this browser's email limit, a
 * sign-in that went through late carries on). Pure, so node:test covers it.
 */

/** How long each kind of request may take, in milliseconds. */
export const TIME_LIMIT_MS = {
  /** Requests that send an email (a code, a confirmation, a reset link): Supabase answers once the mail has gone. */
  email: 30_000,
  /** Checking a code or a password, a Google sign-in, saving a new password. */
  check: 20_000,
  /** FITX's own sign-in finish (/api/auth/session) after Supabase said yes; past it the browser goes on regardless. */
  finish: 15_000,
} as const;

export class TimeLimitError extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super(`no answer within ${ms} ms`);
    this.name = "TimeLimitError";
    this.ms = ms;
  }
}

/** True for the error withTimeLimit rejects with. */
export function isTimeLimit(error: unknown): error is TimeLimitError {
  return error instanceof TimeLimitError;
}

/**
 * Settles as `work` does, or rejects with a TimeLimitError once `ms` pass without an answer. The timer is cleared as
 * soon as `work` settles, so nothing is left running. When the answer comes after the limit, `late` gets it (a late
 * failure is dropped: the form already said it stopped waiting). Typed by `work` itself, so a handler that
 * destructures the answer gets the request's own answer type.
 */
export function withTimeLimit<W extends PromiseLike<unknown>>(work: W, ms: number, late?: (value: Awaited<W>) => void): Promise<Awaited<W>> {
  type T = Awaited<W>;
  return new Promise<T>((resolve, reject) => {
    let waiting = true;
    const timer = setTimeout(() => {
      waiting = false;
      reject(new TimeLimitError(ms));
    }, ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        if (waiting) return resolve(value);
        try {
          late?.(value);
        } catch {
          // A late answer's follow-up never breaks the page.
        }
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (waiting) reject(error);
      },
    );
  });
}

/**
 * What each form says when its request runs out of time: what happened, what to do, and what a late answer does.
 * "Try again" is always safe: an email sent late is caught by this browser's email cooldown or by Supabase's own
 * limit, which then shows the code step for the code already on its way.
 */
export const TIMED_OUT = {
  sendCode: "Sending your code is taking too long, so we stopped waiting. Check your connection and try again. If a code arrives meanwhile, it still works.",
  verifyCode: "Checking your code is taking too long, so we stopped waiting. Check your connection and try again. If the check still goes through, you’ll be signed in.",
  signIn: "Signing in is taking too long, so we stopped waiting. Check your connection and try again. If it still goes through, you’ll be signed in.",
  google: "Signing in with Google is taking too long, so we stopped waiting. Check your connection and try again. If it still goes through, you’ll be signed in.",
  signUp: "Creating your account is taking too long, so we stopped waiting. Check your connection and try again. If it still goes through, this page moves on.",
  resetLink: "Sending the reset link is taking too long, so we stopped waiting. Check your connection and try again. If a link arrives meanwhile, it still works.",
  newPassword: "Saving your new password is taking too long, so we stopped waiting. Check your connection and try again. If it still goes through, this page will say so.",
} as const;
