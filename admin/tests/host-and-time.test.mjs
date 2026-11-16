import test from "node:test";
import assert from "node:assert/strict";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { canonicalRedirectUrl } = await importTypeScriptModule("src/lib/canonical-host.ts");
const { formatIstDate, formatIstDateTime } = await importTypeScriptModule("src/lib/time.ts");

const production = { vercelEnv: "production", siteUrl: "https://fitnessx-admin.vercel.app" };

test("production requests on another host move to ADMIN_SITE_URL with the same path and query", () => {
  const url = canonicalRedirectUrl({ ...production, requestUrl: "https://admin-one-blond.vercel.app/users?page=2", host: "admin-one-blond.vercel.app" });
  assert.equal(url?.href, "https://fitnessx-admin.vercel.app/users?page=2");

  const withSlash = canonicalRedirectUrl({ ...production, siteUrl: "https://fitnessx-admin.vercel.app/", requestUrl: "https://old.vercel.app/", host: "old.vercel.app" });
  assert.equal(withSlash?.href, "https://fitnessx-admin.vercel.app/");
});

test("a path that starts with two slashes stays on the canonical host", () => {
  const url = canonicalRedirectUrl({ ...production, requestUrl: "https://old.vercel.app//evil.example/x?y=1", host: "old.vercel.app" });
  assert.equal(url?.host, "fitnessx-admin.vercel.app");
  assert.equal(url?.href, "https://fitnessx-admin.vercel.app//evil.example/x?y=1");
});

test("the canonical host, previews, local development and unusable settings are not redirected", () => {
  const request = { requestUrl: "https://admin-one-blond.vercel.app/overview", host: "admin-one-blond.vercel.app" };
  assert.equal(canonicalRedirectUrl({ ...production, requestUrl: "https://fitnessx-admin.vercel.app/overview", host: "FitnessX-Admin.vercel.app" }), null);
  assert.equal(canonicalRedirectUrl({ ...request, vercelEnv: "preview", siteUrl: production.siteUrl }), null);
  assert.equal(canonicalRedirectUrl({ ...request, vercelEnv: undefined, siteUrl: production.siteUrl }), null);
  assert.equal(canonicalRedirectUrl({ ...request, vercelEnv: "production", siteUrl: undefined }), null);
  assert.equal(canonicalRedirectUrl({ ...request, vercelEnv: "production", siteUrl: "not a url" }), null);
  assert.equal(canonicalRedirectUrl({ ...request, vercelEnv: "production", siteUrl: "ftp://fitnessx-admin.vercel.app" }), null);
  assert.equal(canonicalRedirectUrl({ ...production, requestUrl: request.requestUrl, host: null }), null);
});

test("times are shown in IST whatever the server's own time zone", () => {
  assert.match(formatIstDateTime("2026-11-16T20:05:00Z"), /^17 Nov 2026, 1:35\s?am IST$/iu);
  assert.equal(formatIstDate("2026-11-16T20:05:00Z"), "17 Nov 2026");
  assert.equal(formatIstDate("2026-11-16T18:00:00Z"), "16 Nov 2026");
  assert.equal(formatIstDate("not a date"), null);
  assert.equal(formatIstDateTime(null), null);
  assert.equal(formatIstDateTime(""), null);
});
