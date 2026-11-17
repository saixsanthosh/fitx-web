// HS256 JSON Web Tokens for the e2e Supabase stand-in. The secret is a fixed, local-only test value: the
// anon key is baked into the app bundle at build time, so it has to stay the same between the build and
// every later run. It signs nothing but tokens for the throwaway database on this machine.
import { createHmac, timingSafeEqual } from "node:crypto";

export const E2E_JWT_SECRET = "fitx-e2e-local-only-jwt-secret-not-a-real-credential-0001";

const b64url = (value) => Buffer.from(value).toString("base64url");

export function signJwt(payload, secret = E2E_JWT_SECRET) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

/**
 * The token's claims, or { error } as PostgREST and Supabase Auth would see it:
 * "invalid" (malformed or a bad signature) or "expired".
 */
export function verifyJwt(token, secret = E2E_JWT_SECRET, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string") return { error: "invalid" };
  const parts = token.split(".");
  if (parts.length !== 3) return { error: "invalid" };
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { error: "invalid" };
  }
  if (header?.alg !== "HS256") return { error: "invalid" };
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { error: "invalid" };
  if (typeof claims?.exp === "number" && claims.exp <= nowSeconds) return { error: "expired", claims };
  return { claims };
}

/** The project's API keys as Supabase issues them (legacy JWT keys), valid until 2099. */
export function apiKeys(secret = E2E_JWT_SECRET) {
  const iat = 1763337600; // 2025-11-17
  const exp = 4102444800; // 2100-01-01
  return {
    anon: signJwt({ iss: "supabase", ref: "fitx-e2e", role: "anon", iat, exp }, secret),
    serviceRole: signJwt({ iss: "supabase", ref: "fitx-e2e", role: "service_role", iat, exp }, secret),
  };
}
