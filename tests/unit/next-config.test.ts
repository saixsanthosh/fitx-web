import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import nextConfig, { assertFilmFixtureAllowed, cameraRedirects, FILM_CACHE_RULE, FORM_CHECK_PATH } from "../../next.config.ts";

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

test("the films' hashed files are cached for a year (BRIEF-2 3.1)", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const films = rules.find((rule) => rule.source === "/brand/films/:path*");
  assert.deepEqual(films?.headers, [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
  assert.deepEqual(films, FILM_CACHE_RULE);
});

test("a Vercel production build refuses the film fixture; every other build may carry it (BRIEF-2 3.4)", () => {
  assert.throws(() => assertFilmFixtureAllowed({ NEXT_PUBLIC_FITX_FILM_FIXTURE: "1", VERCEL_ENV: "production" }), /e2e build only/);
  for (const env of [
    { NEXT_PUBLIC_FITX_FILM_FIXTURE: "1" },
    { NEXT_PUBLIC_FITX_FILM_FIXTURE: "1", VERCEL_ENV: "preview" },
    { VERCEL_ENV: "production" },
    { NEXT_PUBLIC_FITX_FILM_FIXTURE: "0", VERCEL_ENV: "production" },
    {},
  ]) assert.doesNotThrow(() => assertFilmFixtureAllowed(env), JSON.stringify(env));
});
