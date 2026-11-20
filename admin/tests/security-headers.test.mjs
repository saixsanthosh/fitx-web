// FITX Admin's fixed security headers (next.config.ts); the nonce CSP itself is in session-and-csp.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const config = await importTypeScriptModule("next.config.ts");

test("every Admin path gets HSTS, isolation, no framing, no device access and no caching", async () => {
  const rules = await config.default.headers();
  const everyPath = rules.find((rule) => rule.source === "/:path*")?.headers ?? [];
  assert.deepEqual(everyPath, config.ADMIN_SECURITY_HEADERS);
  const get = (key) => everyPath.find((header) => header.key === key)?.value;
  assert.equal(get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assert.equal(get("Cross-Origin-Opener-Policy"), "same-origin");
  assert.equal(get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.equal(get("X-Content-Type-Options"), "nosniff");
  assert.equal(get("X-Frame-Options"), "DENY");
  assert.equal(get("Referrer-Policy"), "same-origin");
  for (const feature of ["camera", "microphone", "geolocation", "payment"]) assert.ok(get("Permissions-Policy").split(", ").includes(`${feature}=()`), feature);
  assert.equal(get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  assert.match(get("Cache-Control"), /no-store/);
  // The CSP stays in the proxy, built per response with a nonce.
  assert.equal(get("Content-Security-Policy"), undefined);
  assert.equal(config.default.poweredByHeader, false);
});
