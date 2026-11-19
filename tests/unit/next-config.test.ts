import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../../next.config.ts";

test("the form coach's pose runtime and models are cached for a year; every path keeps the security headers", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const pose = rules.find((rule) => rule.source === "/models/pose/:path*");
  assert.deepEqual(pose?.headers, [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
  const everyPath = rules.find((rule) => rule.source === "/:path*");
  const policy = everyPath?.headers.find((header) => header.key === "Permissions-Policy")?.value ?? "";
  assert.match(policy, /camera=\(self\)/);
  assert.match(policy, /geolocation=\(self\)/);
});

test("the old Form coach address redirects permanently to Home workout (the query is passed through)", async () => {
  const rules = (await nextConfig.redirects?.()) ?? [];
  const moved = rules.filter((rule) => rule.source.startsWith("/form-coach"));
  assert.deepEqual(moved.map((rule) => [rule.source, rule.destination, rule.permanent]), [
    ["/form-coach", "/home-workout", true],
    ["/form-coach/:path*", "/home-workout", true],
  ]);
});

test("images are served as AVIF, then WebP", () => {
  assert.deepEqual(nextConfig.images?.formats, ["image/avif", "image/webp"]);
});
