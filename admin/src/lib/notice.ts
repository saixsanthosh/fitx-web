import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { firstParam } from "@/lib/search-params";

// What a page says after a Server Action ("Saved.", "2 accounts suspended …") reaches it in the address the action
// redirects to, as a sealed token: the result's code (and count), when it stops showing, and an HMAC-SHA-256 tag keyed
// from the server-only Supabase key and bound to the operator who acted. A page shows a notice only from its own
// operator's action in the last 10 minutes, in the page's own fixed words. Anything else in the address (a code, a
// number, a sentence typed into a link) is ignored, so a link can never speak in Admin's voice (BUGS.md 1).
//
// Token: "<code>.<count>.<expiry, base 36 ms>.<tag>", e.g. "bulk_suspended.2.mii9x2pk.<22 characters>".

export const NOTICE_TTL_MS = 10 * 60_000;
/** Who a notice on the sign-in page is for: nobody is signed in there. */
export const SIGN_IN_NOTICE = "sign-in";
const CODE = /^[a-z][a-z0-9_]{0,47}$/;
const TOKEN = /^([a-z][a-z0-9_]{0,47})\.(\d{0,6})\.([0-9a-z]{1,11})\.([A-Za-z0-9_-]{22})$/;
const MAX_COUNT = 999_999;

export type ActionNotice = { code: string; count: number | null };

function noticeKey(): Buffer | null {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return Buffer.from(hkdfSync("sha256", secret, "fitx-admin", "action-notice-v1", 32));
}

function tag(key: Buffer, binding: string, body: string): string {
  return createHmac("sha256", key).update(`${binding}\n${body}`).digest().subarray(0, 16).toString("base64url");
}

/** A token for `code` (and a whole `count`) for `binding` (the acting operator's ID); null without the server key. */
export function sealNotice(code: string, binding: string, { count = null, now = Date.now() }: { count?: number | null; now?: number } = {}): string | null {
  const key = noticeKey();
  if (!key || !binding || !CODE.test(code)) return null;
  if (count !== null && !(Number.isSafeInteger(count) && count >= 0 && count <= MAX_COUNT)) return null;
  const body = `${code}.${count ?? ""}.${(now + NOTICE_TTL_MS).toString(36)}`;
  return `${body}.${tag(key, binding, body)}`;
}

/** The notice in a token made for `binding` that has not expired; null when missing, altered, expired or someone else's. */
export function openNotice(token: unknown, binding: string, now = Date.now()): ActionNotice | null {
  const key = noticeKey();
  if (!key || !binding || typeof token !== "string") return null;
  const match = TOKEN.exec(token);
  if (!match) return null;
  const body = `${match[1]}.${match[2]}.${match[3]}`;
  const expected = Buffer.from(tag(key, binding, body));
  const given = Buffer.from(match[4]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!(parseInt(match[3], 36) > now)) return null;
  return { code: match[1], count: match[2] === "" ? null : Number(match[2]) };
}

/**
 * Where a Server Action goes with its result: `path` with the sealed notice in `param` ("notice", or "state" on the
 * pages that always used it). Without the server key nothing can be sealed, so the page opens with no notice.
 */
export function noticeHref(path: string, code: string, binding: string, { count = null, param = "notice" }: { count?: number | null; param?: string } = {}): string {
  const token = sealNotice(code, binding, { count });
  if (!token) return path;
  const url = new URL(path, "https://admin.invalid");
  url.searchParams.set(param, token);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The result a page was opened with: only a token from this operator's own action in the last 10 minutes. */
export function pageNotice(value: string | string[] | undefined, binding: string): ActionNotice | null {
  return openNotice(firstParam(value), binding);
}

/** A page's own words for a notice: null for no notice, or a code the page does not have. */
export function noticeWords<T>(table: Readonly<Record<string, T>>, notice: ActionNotice | null): T | null {
  return notice && Object.hasOwn(table, notice.code) ? table[notice.code] : null;
}
