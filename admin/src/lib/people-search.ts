import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// The Users search text (an email, a phone number, a name) never goes in a URL, where it would land in the
// host's request logs and the browser history. The search form posts it to a Server Action, which seals it
// into this opaque token: AES-256-GCM under a key derived from the server-only Supabase key, bound to the
// operator who searched, and good for 30 minutes. The list's links carry only the token.

export const PEOPLE_SEARCH_PARAM = "s";
export const PEOPLE_SEARCH_TTL_MS = 30 * 60_000;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function searchKey(): Buffer | null {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return Buffer.from(hkdfSync("sha256", secret, "fitx-admin", "people-search-token-v1", 32));
}

/** The search text sealed for this operator, or null when the server key is not configured. */
export function sealPeopleSearch(query: string, operatorId: string, now = Date.now()): string | null {
  const key = searchKey();
  if (!key) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(operatorId));
  const body = Buffer.concat([cipher.update(JSON.stringify({ q: query, e: now + PEOPLE_SEARCH_TTL_MS }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** The search text from a token this operator made in the last 30 minutes; null when missing, altered or expired. */
export function openPeopleSearch(token: string, operatorId: string, now = Date.now()): string | null {
  const key = searchKey();
  if (!key || !token || token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(operatorId));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
    const payload: unknown = JSON.parse(text);
    if (!payload || typeof payload !== "object") return null;
    const { q, e } = payload as { q?: unknown; e?: unknown };
    if (typeof q !== "string" || typeof e !== "number" || !(now < e)) return null;
    return q;
  } catch {
    return null;
  }
}
