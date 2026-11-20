// scrypt password hashes for Admin operators. Imports only node:crypto, so tests can load it directly.
// Stored as scrypt:<N>:<r>:<p>:<salt base64url>:<key base64url>. Colons, not "$": Next expands $NAME in
// .env files, which would corrupt a hash kept in .env.local. admin/scripts/hash-password.mjs makes the same
// format for FITX_ADMIN_PASSWORD_HASH.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, keyLength: 64, saltLength: 16, maxmem: 64 * 1024 * 1024 } as const;
/** Operators' passwords; the owner's root password only needs 8 (admin:hash warns under 12). */
export const MIN_PASSWORD_LENGTH = 12;
/** Longer input is refused before hashing, so nobody can make the server hash megabytes. */
export const MAX_PASSWORD_LENGTH = 256;

export type ParsedHash = { N: number; r: number; p: number; salt: Buffer; key: Buffer };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function decode(value: string, bytes: number): Buffer | null {
  if (!BASE64URL.test(value)) return null;
  const buffer = Buffer.from(value, "base64url");
  // Only the canonical spelling: the same bytes always give the same text.
  return buffer.length === bytes && buffer.toString("base64url") === value ? buffer : null;
}

/** The parts of a stored hash, or null unless it is well formed: N 2^15 to 2^20, r 8, p 1 to 4, 16-byte salt, 64-byte key. */
export function parsePasswordHash(stored: unknown): ParsedHash | null {
  if (typeof stored !== "string" || stored.length > 200) return null;
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, nText, rText, pText, saltText, keyText] = parts;
  if (![nText, rText, pText].every((part) => /^[1-9][0-9]{0,7}$/.test(part))) return null;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (N < 2 ** 15 || N > 2 ** 20 || (N & (N - 1)) !== 0) return null;
  if (r !== 8 || p < 1 || p > 4) return null;
  const salt = decode(saltText, SCRYPT_PARAMS.saltLength);
  const key = decode(keyText, SCRYPT_PARAMS.keyLength);
  if (!salt || !key) return null;
  return { N, r, p, salt, key };
}

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  // scrypt needs about 128 × N × r bytes; leave headroom above the default for N up to 2^20.
  const maxmem = Math.max(SCRYPT_PARAMS.maxmem, 128 * N * r + 16 * 1024 * 1024);
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, SCRYPT_PARAMS.keyLength, { N, r, p, maxmem }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** A new hash with a fresh random salt. */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    throw new TypeError(`A password must be 1 to ${MAX_PASSWORD_LENGTH} characters`);
  }
  const { N, r, p, saltLength } = SCRYPT_PARAMS;
  const salt = randomBytes(saltLength);
  const key = await derive(password, salt, N, r, p);
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

/** True only when the password matches a well-formed stored hash; false for anything malformed. */
export async function verifyPassword(password: unknown, stored: unknown): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  try {
    const key = await derive(password, parsed.salt, parsed.N, parsed.r, parsed.p);
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  } catch {
    return false;
  }
}
