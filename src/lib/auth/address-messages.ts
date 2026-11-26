import { SUSPENDED_MESSAGE } from "@/lib/platform/account-status";
import { NOTICE_PROOF_COOKIE, NOTICE_PROOF_MAX_AGE, noticeProofCookieOptions } from "./cookies";

/**
 * Messages the sign-in page reads from its own address: ?error= when a sign-in comes back without one (Google, an email
 * link, a suspended account), ?signed_out= after Log out or Sign out everywhere, and ?setup= when this environment has
 * no Supabase. Each says what already happened, so once the member acts on the page (sends a code, signs in, starts
 * Google) the page stops showing them and takes ?error= and ?signed_out= out of its address (bug 44): a new code, Change
 * email or a reload never brings an old "link has expired" back. Pure, so node:test covers it; SignInForm shows them.
 *
 * Any link can carry any of these addresses, and FITX's own page would then vouch for it. So the address alone makes the
 * page say only what is true for everyone the proxy shows it to ("You’re signed out on this device": the proxy sends a
 * signed-in member on). Saying that every device is signed out also needs the proof FITX leaves in this browser just
 * before it sends it here (NOTICE_PROOF_COOKIE, src/lib/auth/cookies.ts), which a link can't set (review
 * security:R3-SEC-1): otherwise a mail saying "we've secured your account" could link to FITX's own page to confirm it,
 * and the member would see no reason to press Sign out everywhere themselves.
 */

/** ?error= values, set by /auth/callback and the proxy. Anything else in the address is ignored. */
export const ADDRESS_ERRORS: Readonly<Record<string, string>> = {
  cancelled: "Google sign-in was cancelled. Try again whenever you’re ready.",
  provider: "Google sign-in is not turned on for FITX yet. Use your email instead.",
  callback: "We couldn’t complete sign-in. Please try again.",
  browser: "That link was opened in a different browser or app. Sign in again here.",
  expired: "That link has expired or was already used. Sign in again, or ask for a new code.",
  suspended: SUSPENDED_MESSAGE,
};

export const SETUP_MISSING = "Account access is not configured in this environment yet.";

/** After Log out, which ends the session in this browser only. */
export const SIGNED_OUT_HERE = "You’re signed out on this device.";
/** After Sign out everywhere ("Sign out of FITX on every device, including this one?") that Auth confirmed, bug 42. */
export const SIGNED_OUT_EVERYWHERE = "You’re signed out everywhere, including this device.";
/**
 * After Sign out everywhere found this device's own session already over (signed out from elsewhere, a password changed
 * in another session), so there was no session to end the others with (review security:R3-SEC-2).
 */
export const SIGNED_OUT_ENDED =
  "This device was already signed out, so FITX couldn’t sign out your other devices. Sign in again, then use Sign out everywhere in Settings.";

/**
 * Where signing out lands: Log out ("local"), and Sign out everywhere ("global") as it turned out: "signed_out" once Auth
 * confirmed it, "ended" when this device's session was already over (src/lib/auth/device-sign-out.ts).
 */
export function signedOutAddress(scope: "local" | "global", outcome: "signed_out" | "ended" = "signed_out"): string {
  if (scope === "local") return "/signin?signed_out=1";
  return outcome === "ended" ? "/signin?signed_out=ended" : "/signin?signed_out=everywhere";
}

/** The proof a sign-out leaves for the sign-in page: none for Log out, whose line claims this device only. */
export function signedOutProof(scope: "local" | "global", outcome: "signed_out" | "ended"): NoticeProof | null {
  if (scope === "local") return null;
  return outcome === "ended" ? "ended" : "everywhere";
}

/** The error the address carries, or "". Only known codes count: nothing else from the address is shown. */
export function addressError(search: string): string {
  const query = new URLSearchParams(search);
  const code = query.get("error");
  if (code !== null && Object.hasOwn(ADDRESS_ERRORS, code)) return ADDRESS_ERRORS[code];
  return query.has("setup") ? SETUP_MISSING : "";
}

/** The query without its one-time messages (?error=, ?signed_out=), keeping everything else: ?next= above all. */
export function withoutAddressMessages(search: string): string {
  const query = new URLSearchParams(search);
  query.delete("error");
  query.delete("signed_out");
  const rest = query.toString();
  return rest ? `?${rest}` : "";
}

/**
 * The signed-out notice the address carries, or "". What Sign out everywhere did ("everywhere", or "ended") needs this
 * browser's own proof of it (a link can carry ?signed_out=everywhere too); any other ?signed_out= says "on this device"
 * and never more.
 */
export function addressNotice(search: string, proof: NoticeProof | null = null): string {
  const value = new URLSearchParams(search).get("signed_out");
  if (value === null) return "";
  if (value === "everywhere" && proof === "everywhere") return SIGNED_OUT_EVERYWHERE;
  if (value === "ended" && proof === "ended") return SIGNED_OUT_ENDED;
  return SIGNED_OUT_HERE;
}

/**
 * What FITX itself did just before it sent this browser to the sign-in page: Sign out everywhere confirmed by Auth
 * ("everywhere"), or one that found this device's session already over ("ended").
 */
export type NoticeProof = "everywhere" | "ended";
const PROOFS: ReadonlySet<string> = new Set<NoticeProof>(["everywhere", "ended"]);

function proofCookie(value: string, maxAge: number, secure: boolean): string {
  return `${NOTICE_PROOF_COOKIE}=${value}; Path=${noticeProofCookieOptions(secure).path}; Max-Age=${maxAge}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** document.cookie text that leaves `proof` for the sign-in page, for two minutes (cookies.ts). */
export function noticeProofCookie(proof: NoticeProof, secure: boolean): string {
  return proofCookie(proof, NOTICE_PROOF_MAX_AGE, secure);
}

/** The proof a cookie string (document.cookie) holds, and whether the cookie is there at all. */
function readProof(cookies: string): { present: boolean; proof: NoticeProof | null } {
  for (const part of cookies.split(";")) {
    const at = part.indexOf("=");
    if ((at < 0 ? part : part.slice(0, at)).trim() !== NOTICE_PROOF_COOKIE) continue;
    const value = at < 0 ? "" : part.slice(at + 1).trim();
    return { present: true, proof: PROOFS.has(value) ? (value as NoticeProof) : null };
  }
  return { present: false, proof: null };
}

/** Each page's answer (the key is the page's document), so React's repeated asks agree with the first. */
const taken = new WeakMap<object, NoticeProof | null>();

/**
 * The proof this browser left for the sign-in page, read once per page and then removed, so it never speaks for a later
 * visit or for a link opened afterwards. The page keeps its answer while it shows (Back inside the page's own document
 * included). `page` is `document` in the app; `secure` says whether the page is on HTTPS.
 */
export function takeNoticeProof(page: { cookie: string }, secure: boolean): NoticeProof | null {
  if (taken.has(page)) return taken.get(page) ?? null;
  const { present, proof } = readProof(page.cookie);
  taken.set(page, proof);
  if (present) page.cookie = proofCookie("", 0, secure);
  return proof;
}
