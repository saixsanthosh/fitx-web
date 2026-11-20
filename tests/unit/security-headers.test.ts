// The app's security headers and Content-Security-Policy (next.config.ts): a real policy that keeps pages static,
// with the Supabase origin and its websocket origin taken from NEXT_PUBLIC_SUPABASE_URL, the same way for the hosted
// project and the e2e stand-in.
import test from "node:test";
import assert from "node:assert/strict";
import nextConfig, { buildContentSecurityPolicy, CSP_ENFORCED, securityHeaders, supabaseOrigins } from "../../next.config.ts";

const directives = (policy: string) => new Map(policy.split("; ").map((part) => {
  const [name, ...sources] = part.split(" ");
  return [name, sources] as const;
}));

test("the Supabase origin and its websocket origin come from NEXT_PUBLIC_SUPABASE_URL", () => {
  assert.deepEqual(supabaseOrigins("https://abcd.supabase.co"), { http: "https://abcd.supabase.co", ws: "wss://abcd.supabase.co" });
  assert.deepEqual(supabaseOrigins("https://abcd.supabase.co/some/path?x=1"), { http: "https://abcd.supabase.co", ws: "wss://abcd.supabase.co" });
  // The local stand-in is plain http, so it talks ws://.
  assert.deepEqual(supabaseOrigins("http://fitx-e2e-db.localhost:3721"), { http: "http://fitx-e2e-db.localhost:3721", ws: "ws://fitx-e2e-db.localhost:3721" });
  for (const value of [undefined, null, "", "not a url", "javascript:alert(1)", "ftp://x.example"]) {
    assert.deepEqual(supabaseOrigins(value), { http: "https://*.supabase.co", ws: "wss://*.supabase.co" }, String(value));
  }
});

test("the policy allows only what the app loads, and nothing that would make pages dynamic", () => {
  const policy = directives(buildContentSecurityPolicy({ supabaseUrl: "https://abcd.supabase.co" }));
  assert.deepEqual(policy.get("default-src"), ["'self'"]);
  assert.deepEqual(policy.get("script-src"), ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "https://checkout.razorpay.com"]);
  assert.deepEqual(policy.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(policy.get("connect-src"), [
    "'self'", "https://abcd.supabase.co", "wss://abcd.supabase.co", "https://tiles.openfreemap.org", "https://api.razorpay.com", "https://lumberjack.razorpay.com",
  ]);
  assert.ok(policy.get("img-src")?.includes("https://abcd.supabase.co"));
  assert.ok(policy.get("img-src")?.includes("blob:") && policy.get("img-src")?.includes("data:"));
  assert.ok(!policy.get("img-src")?.includes("https:"), "no blanket https: for images");
  // Google sign-in members' profile photos (profiles.avatar keeps Google's avatar_url), shown unoptimised.
  assert.ok(policy.get("img-src")?.includes("https://lh3.googleusercontent.com"), "Google profile photos load");
  assert.ok(!policy.get("img-src")?.some((source) => source.includes("*.googleusercontent.com")), "only Google's avatar hosts, not all of googleusercontent.com");
  assert.deepEqual(policy.get("media-src"), ["'self'", "blob:", "https://abcd.supabase.co"]);
  assert.deepEqual(policy.get("frame-src"), ["https://api.razorpay.com", "https://checkout.razorpay.com"]);
  assert.deepEqual(policy.get("font-src"), ["'self'"]);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("base-uri"), ["'self'"]);
  assert.deepEqual(policy.get("form-action"), ["'self'"]);
  assert.deepEqual(policy.get("frame-ancestors"), ["'none'"]);
  const text = [...policy.values()].flat().join(" ");
  assert.doesNotMatch(text, /'unsafe-eval'|'nonce-|'strict-dynamic'/, "no eval in production, no nonce (pages stay static)");
  assert.ok(!policy.has("upgrade-insecure-requests"), "it would break the local http stand-in; HSTS covers production");
});

test("the e2e stand-in is allowed exactly the way the hosted project is", () => {
  const hosted = buildContentSecurityPolicy({ supabaseUrl: "https://abcd.supabase.co" });
  const standin = buildContentSecurityPolicy({ supabaseUrl: "http://fitx-e2e-db.localhost:3721" });
  assert.equal(standin, hosted.replaceAll("https://abcd.supabase.co", "http://fitx-e2e-db.localhost:3721").replaceAll("wss://abcd.supabase.co", "ws://fitx-e2e-db.localhost:3721"));
});

test("development adds eval for React's debugging stacks; preview deployments add the Vercel toolbar", () => {
  const dev = directives(buildContentSecurityPolicy({ supabaseUrl: "https://abcd.supabase.co", isDev: true }));
  assert.ok(dev.get("script-src")?.includes("'unsafe-eval'"));
  const preview = directives(buildContentSecurityPolicy({ supabaseUrl: "https://abcd.supabase.co", isPreview: true }));
  for (const name of ["script-src", "connect-src", "frame-src", "img-src", "font-src"]) assert.ok(preview.get(name)?.includes("https://vercel.live"), name);
  const production = buildContentSecurityPolicy({ supabaseUrl: "https://abcd.supabase.co" });
  assert.doesNotMatch(production, /vercel\.live/);
});

test("every path gets HSTS, COOP, nosniff, framing and referrer rules, a tight Permissions-Policy and the enforced CSP", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const everyPath = rules.find((rule) => rule.source === "/:path*")?.headers ?? [];
  const get = (key: string) => everyPath.find((header) => header.key === key)?.value;
  assert.equal(get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assert.doesNotMatch(get("Strict-Transport-Security") ?? "", /preload/);
  assert.equal(get("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
  assert.equal(get("X-Content-Type-Options"), "nosniff");
  assert.equal(get("X-Frame-Options"), "DENY");
  assert.equal(get("Referrer-Policy"), "strict-origin-when-cross-origin");
  const permissions = get("Permissions-Policy") ?? "";
  for (const rule of ["camera=(self)", "geolocation=(self)", "microphone=()", "screen-wake-lock=(self)", 'payment=(self "https://api.razorpay.com")']) {
    assert.ok(permissions.split(", ").includes(rule), rule);
  }
  assert.equal(CSP_ENFORCED, true);
  assert.ok(get("Content-Security-Policy"), "the policy is enforced");
  assert.equal(get("Content-Security-Policy-Report-Only"), undefined);
  assert.equal(nextConfig.poweredByHeader, false, "no X-Powered-By");
  // The pose runtime's cache rule is still there.
  assert.ok(rules.some((rule) => rule.source === "/models/pose/:path*"));
});

test("FITX_CSP_REPORT_ONLY switches the same policy to report-only", () => {
  const enforced = securityHeaders({ supabaseUrl: "https://abcd.supabase.co" });
  const reporting = securityHeaders({ supabaseUrl: "https://abcd.supabase.co", reportOnly: true });
  const value = (list: typeof enforced, key: string) => list.find((header) => header.key === key)?.value;
  assert.equal(value(reporting, "Content-Security-Policy"), undefined);
  assert.equal(value(reporting, "Content-Security-Policy-Report-Only"), value(enforced, "Content-Security-Policy"));
});
