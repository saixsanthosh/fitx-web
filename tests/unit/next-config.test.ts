import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import nextConfig, { cameraRedirects, FORM_CHECK_PATH } from "../../next.config.ts";

test("the form coach's pose runtime and models are cached for a year; every path keeps the security headers", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const pose = rules.find((rule) => rule.source === "/models/pose/:path*");
  assert.deepEqual(pose?.headers, [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
  const everyPath = rules.find((rule) => rule.source === "/:path*");
  const policy = everyPath?.headers.find((header) => header.key === "Permissions-Policy")?.value ?? "";
  assert.match(policy, /camera=\(self\)/);
  assert.match(policy, /geolocation=\(self\)/);
  // The sign-in scene's tilt (motion sensors, read on the device) and the AI Coach's push-to-talk.
  for (const rule of ["accelerometer=(self)", "gyroscope=(self)", "microphone=(self)"]) assert.ok(policy.split(", ").includes(rule), rule);
  assert.ok(policy.split(", ").includes("magnetometer=()"), "the compass stays off");
});

test("the retired camera addresses redirect permanently (the query is passed through), to AI Form Check once its page is built", async () => {
  const rows = (rules: ReturnType<typeof cameraRedirects>) => rules.map((rule) => [rule.source, rule.destination, rule.permanent]);
  assert.equal(FORM_CHECK_PATH, "/workouts/form-check");
  assert.deepEqual(rows(cameraRedirects(true)), [
    ["/home-workout", "/workouts/form-check", true],
    ["/form-coach", "/workouts/form-check", true],
    ["/form-coach/:path*", "/workouts/form-check", true],
  ]);
  // A build without the AI Form Check page never points a link at it: Form coach keeps ending on Home workout.
  assert.deepEqual(rows(cameraRedirects(false)), [
    ["/form-coach", "/home-workout", true],
    ["/form-coach/:path*", "/home-workout", true],
  ]);
  const built = existsSync(new URL("../../src/app/(dashboard)/workouts/form-check/page.tsx", import.meta.url));
  const rules = (await nextConfig.redirects?.()) ?? [];
  assert.deepEqual(rows(rules.filter((rule) => /^\/(form-coach|home-workout)/.test(rule.source)) as ReturnType<typeof cameraRedirects>), rows(cameraRedirects(built)));
});

test("images are served as AVIF, then WebP", () => {
  assert.deepEqual(nextConfig.images?.formats, ["image/avif", "image/webp"]);
});
