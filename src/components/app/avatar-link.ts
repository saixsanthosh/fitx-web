/**
 * The signed link to the member's own profile photo that the shared user context (UserContextProvider) keeps for the
 * header and the sidebar, with a time limit on each request (fix round 3f, open-3e-photo-link-limit).
 *
 * A photo the member uploaded is private (the fitx-user-media bucket), so the shell shows it by a signed link that
 * lasts an hour and is renewed ten minutes before it ends. The link request had no time limit, and the renewal was set
 * only after an answer. So a request that never answered (a stalled connection, a captive portal, a server that hangs)
 * was never made again until the photo itself changed. The header and the sidebar showed their own fetch's link
 * meanwhile (accountSummary.ts preferSharedAccount), or none.
 *
 * Now each request is waited for AVATAR_LINK_TIME_LIMIT_MS (20 s, like the context's own refresh). Past that, what the
 * header shows stays (its own fetch's link, or the shared link still in use while it is renewed), and the request is
 * made again after a pause: 20 s, doubled each time a request goes unanswered again, up to the renewal's 50 minutes, so
 * a server that stays hung isn't asked every few seconds. Nothing is cancelled (storage's client can't be): a link that
 * comes late is still used, unless a newer request's link already shows. Answers within 20 s are used as before: the
 * link, or none when storage refused it (the header's own link then shows), and the renewal 50 minutes later.
 *
 * No React here, so node:test covers it (tests/shell/avatar-link-limit.test.ts).
 */

/** How long a signed link to the photo lasts, in seconds. */
export const AVATAR_LINK_SECONDS = 60 * 60;
/** Renew the signed photo link ten minutes before it expires. */
export const AVATAR_RENEW_MS = (AVATAR_LINK_SECONDS - 10 * 60) * 1000;
/** How long one link request is waited for, in milliseconds. */
export const AVATAR_LINK_TIME_LIMIT_MS = 20_000;
/** The pause before a link request that went unanswered is made again; it doubles each time, up to AVATAR_RENEW_MS. */
export const AVATAR_LINK_RETRY_MS = 20_000;

/** What storage's link request gives (createSignedUrl). */
export type SignedLinkAnswer = { data: { signedUrl: string } | null; error: unknown };

/** The pause before the next try once `misses` requests in a row (1 or more) have gone unanswered past the limit. */
export function linkRetryPause(misses: number, retryMs: number = AVATAR_LINK_RETRY_MS, renewMs: number = AVATAR_RENEW_MS): number {
  return Math.min(retryMs * 2 ** Math.max(0, misses - 1), renewMs);
}

/**
 * Gives `show` a working link to the photo at `path` (the profile's `avatar`) until the returned stop function runs (the
 * photo changed, or the provider went): null for no photo, a provider's photo URL as it is, and for a stored photo a
 * link `sign` asks storage for, renewed before it ends. `sign` is null where Supabase isn't set up: nothing is shown
 * then. The first step runs a turn later, never inside the caller (a React effect). Once stopped, nothing more is shown
 * or asked.
 */
export function keepAvatarLink(
  path: string | null,
  sign: ((path: string) => PromiseLike<SignedLinkAnswer>) | null,
  show: (url: string | null) => void,
  { ms = AVATAR_LINK_TIME_LIMIT_MS, retryMs = AVATAR_LINK_RETRY_MS, renewMs = AVATAR_RENEW_MS }: { ms?: number; retryMs?: number; renewMs?: number } = {},
): () => void {
  let stopped = false;
  /** The newest request's limit, and the one next step: the renewal after an answer, or the retry after a time-out. */
  let limit: ReturnType<typeof setTimeout> | undefined;
  let next: ReturnType<typeof setTimeout> | undefined;

  const keepSigned = (stored: string, signLink: (path: string) => PromiseLike<SignedLinkAnswer>) => {
    /** Requests made so far, the one whose answer shows (0: none yet), and requests in a row that went unanswered. */
    let made = 0;
    let shown = 0;
    let misses = 0;

    function land(mine: number, url: string | null) {
      if (stopped || mine <= shown) return;
      shown = mine;
      misses = 0;
      clearTimeout(limit);
      clearTimeout(next);
      show(url);
      next = setTimeout(request, renewMs);
    }

    function request() {
      const mine = ++made;
      clearTimeout(limit);
      clearTimeout(next);
      // Past the limit, what shows stays and the request is made again after a pause; its answer still counts if it
      // comes first.
      limit = setTimeout(() => {
        misses += 1;
        next = setTimeout(request, linkRetryPause(misses, retryMs, renewMs));
      }, ms);
      new Promise<SignedLinkAnswer>((resolve) => resolve(signLink(stored))).then(
        (answer) => land(mine, answer?.data?.signedUrl ?? null),
        // A request that broke off counts as a refused one: no link, and the renewal as usual.
        () => land(mine, null),
      );
    }

    request();
  };

  void Promise.resolve().then(() => {
    if (stopped) return;
    if (!path) return show(null);
    if (/^https:\/\//.test(path)) return show(path);
    if (sign) keepSigned(path, sign);
  });

  return () => {
    stopped = true;
    clearTimeout(limit);
    clearTimeout(next);
  };
}
