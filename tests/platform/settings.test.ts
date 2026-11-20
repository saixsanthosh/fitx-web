// Platform settings as the app reads them, and the one list of features shared by the app, Admin and the
// database function that saves them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRAND } from "@/config/brand";
import {
  FEATURE_KEYS,
  FEATURE_NAMES,
  FEATURE_ROUTES,
  featureForPath,
  isFeatureKey,
  isMaintenanceLive,
  parsePlatformSettings,
  PLATFORM_DEFAULTS,
} from "@/lib/platform/settings";
import * as adminRules from "../../admin/src/components/settings/settings-rules.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20261121100033_fitx_admin_ops.sql", import.meta.url), "utf8");

test("the defaults keep everything on, with the site's own contact details", () => {
  assert.deepEqual(PLATFORM_DEFAULTS.features, { ai_coach: true, home_workout: true, activity: true, subscriptions: true, support: true });
  assert.equal(PLATFORM_DEFAULTS.maintenance, null);
  assert.deepEqual(PLATFORM_DEFAULTS.site, { supportEmail: BRAND.supportEmail, instagramUrl: BRAND.instagramUrl });
  assert.deepEqual(parsePlatformSettings(null), PLATFORM_DEFAULTS);
  assert.deepEqual(parsePlatformSettings("junk"), PLATFORM_DEFAULTS);
  assert.deepEqual(parsePlatformSettings([]), PLATFORM_DEFAULTS);
});

test("a switch is off only when saved as false; bad contact details fall back", () => {
  const parsed = parsePlatformSettings({ features: { ai_coach: false, activity: "no", support: 0 }, site: { supportEmail: "not an email", instagramUrl: "https://evil.example/" } });
  assert.equal(parsed.features.ai_coach, false);
  assert.equal(parsed.features.activity, true);
  assert.equal(parsed.features.support, true);
  assert.deepEqual(parsed.site, PLATFORM_DEFAULTS.site);
  const site = parsePlatformSettings({ site: { supportEmail: "help@example.test", instagramUrl: "https://instagram.com/fitx" } }).site;
  assert.deepEqual(site, { supportEmail: "help@example.test", instagramUrl: "https://instagram.com/fitx" });
});

test("a maintenance notice needs a title and a message, and shows only inside its window", () => {
  assert.equal(parsePlatformSettings({ maintenance: { title: "Up", body: "" } }).maintenance, null);
  const notice = parsePlatformSettings({ maintenance: { title: " Planned upgrade ", body: "Slow tonight.", startsAt: "2026-11-21T10:00:00Z", endsAt: null } }).maintenance;
  assert.deepEqual(notice, { title: "Planned upgrade", body: "Slow tonight.", startsAt: "2026-11-21T10:00:00.000Z", endsAt: null });
  assert.equal(isMaintenanceLive(notice, Date.parse("2026-11-21T09:00:00Z")), false);
  assert.equal(isMaintenanceLive(notice, Date.parse("2026-11-21T11:00:00Z")), true);
  assert.equal(isMaintenanceLive({ title: "x", body: "y", startsAt: null, endsAt: "2026-11-21T10:00:00Z" }, Date.parse("2026-11-21T10:00:00Z")), false);
  assert.equal(isMaintenanceLive(null), false);
});

test("each feature closes its pages and APIs, and nothing else", () => {
  assert.equal(featureForPath("/ai-coach"), "ai_coach");
  assert.equal(featureForPath("/ai-coach/history"), "ai_coach");
  assert.equal(featureForPath("/api/coach/chat", "POST"), "ai_coach");
  assert.equal(featureForPath("/home-workout?exercise=x".split("?")[0]), "home_workout");
  assert.equal(featureForPath("/activity/import"), "activity");
  assert.equal(featureForPath("/activity/record"), "activity");
  assert.equal(featureForPath("/activity/run"), "activity");
  assert.equal(featureForPath("/api/coach/swap", "POST"), "ai_coach");
  assert.equal(featureForPath("/api/coach/actions/abc", "POST"), "ai_coach");
  assert.equal(featureForPath("/api/billing/checkout", "POST"), "subscriptions");
  assert.equal(featureForPath("/api/billing/webhook", "POST"), null, "Razorpay's webhook is never closed");
  assert.equal(featureForPath("/api/support", "POST"), "support");
  assert.equal(featureForPath("/api/support/reply", "post"), "support");
  assert.equal(featureForPath("/api/support", "GET"), null);
  assert.equal(featureForPath("/help"), null, "Help stays open so members can read replies");
  assert.equal(featureForPath("/activityx"), null);
  assert.equal(featureForPath("/dashboard"), null);
  assert.deepEqual(Object.keys(FEATURE_ROUTES), [...FEATURE_KEYS]);
  assert.deepEqual(Object.keys(FEATURE_NAMES), [...FEATURE_KEYS]);
  assert.equal(isFeatureKey("ai_coach"), true);
  assert.equal(isFeatureKey("payments"), false);
});

test("a switch stops new use only: cancelling, coach data controls and saved activities stay open", () => {
  // The only Cancel button, the payments and the refunds are on /subscription; Razorpay keeps charging otherwise.
  assert.equal(featureForPath("/subscription"), null);
  assert.equal(featureForPath("/api/billing/cancel", "POST"), null);
  // Withdrawing consent and deleting coach history (Coach settings on the paused page).
  assert.equal(featureForPath("/api/coach/consent", "POST"), null);
  assert.equal(featureForPath("/api/coach/consent", "DELETE"), null);
  assert.equal(featureForPath("/api/coach/data", "DELETE"), null);
  assert.equal(featureForPath("/api/coach/status"), null);
  assert.equal(featureForPath("/api/coach/threads/abc", "DELETE"), null);
  // Saved walks, runs and rides can still be read, renamed and deleted.
  assert.equal(featureForPath("/activity"), null);
  assert.equal(featureForPath("/activity/00000000-0000-4000-8000-000000000000"), null);
  assert.equal(featureForPath("/activity/recorded"), null, "a prefix of a closed path is not closed");
});

test("the app, Admin and the database agree on the features and the default contact details", () => {
  assert.deepEqual([...adminRules.FEATURE_KEYS], [...FEATURE_KEYS]);
  assert.deepEqual({ ...adminRules.SITE_DEFAULTS }, { supportEmail: BRAND.supportEmail, instagramUrl: BRAND.instagramUrl });
  const listed = migration.match(/feature_keys constant text\[\] := array\[([^\]]+)\]/);
  assert.ok(listed, "the save function lists its feature keys");
  assert.deepEqual(listed[1].split(",").map((key) => key.trim().replace(/'/g, "")), [...FEATURE_KEYS]);
  assert.equal(adminRules.ADMIN_OPS_MIGRATION, "20261121100033_fitx_admin_ops");
  // The same parsing on both sides: a switch saved off reads off in Admin too.
  assert.equal(adminRules.parseSettingsRow({ features: { activity: false } }).features.activity, false);
});
