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
