// Platform settings the app reads (written in FITX Admin, Settings). Pure: no I/O. The same keys and limits
// are in admin/src/components/settings/settings-rules.ts and in fitx_admin_op_save_platform_settings
// (supabase/migrations/20261121100033_fitx_admin_ops.sql); tests/platform/settings.test.ts keeps them equal.
import { BRAND } from "@/config/brand";

export const FEATURE_KEYS = ["ai_coach", "home_workout", "activity", "subscriptions", "support"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type Maintenance = { title: string; body: string; startsAt: string | null; endsAt: string | null };

export type PlatformSettings = {
  features: Record<FeatureKey, boolean>;
  maintenance: Maintenance | null;
  site: { supportEmail: string; instagramUrl: string };
};

/** Everything on, no maintenance notice, the contact details from src/config/brand.ts. */
export const PLATFORM_DEFAULTS: PlatformSettings = Object.freeze({
  features: Object.freeze({ ai_coach: true, home_workout: true, activity: true, subscriptions: true, support: true }),
  maintenance: null,
  site: Object.freeze({ supportEmail: BRAND.supportEmail, instagramUrl: BRAND.instagramUrl }),
}) as PlatformSettings;

/** What members see when a feature is switched off. */
export const FEATURE_NAMES: Record<FeatureKey, string> = {
  ai_coach: "AI coach",
  home_workout: "AI Form Check",
  activity: "Activity",
  subscriptions: "Subscriptions",
  support: "Help messages",
};

const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[A-Za-z]{2,}$/;
const INSTAGRAM = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?$/;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}

function time(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/**
 * A platform_settings row (or anything else) as settings: a switch is off only when saved as false, a
 * maintenance notice needs a title and a message, and contact details fall back to the defaults unless valid.
 */
export function parsePlatformSettings(row: unknown): PlatformSettings {
  const source = record(Array.isArray(row) ? row[0] : row);
  const features = record(source.features);
  const maintenance = source.maintenance === null ? null : record(source.maintenance);
  const site = record(source.site);
  const title = maintenance ? clean(maintenance.title, 120) : "";
  const body = maintenance ? clean(maintenance.body, 600) : "";
  return {
    features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, features[key] !== false])) as Record<FeatureKey, boolean>,
    maintenance: maintenance && title && body ? { title, body, startsAt: time(maintenance.startsAt), endsAt: time(maintenance.endsAt) } : null,
    site: {
      supportEmail: typeof site.supportEmail === "string" && EMAIL.test(site.supportEmail) && site.supportEmail.length <= 254 ? site.supportEmail : PLATFORM_DEFAULTS.site.supportEmail,
      instagramUrl: typeof site.instagramUrl === "string" && INSTAGRAM.test(site.instagramUrl) ? site.instagramUrl : PLATFORM_DEFAULTS.site.instagramUrl,
    },
  };
}

/**
 * The pages and APIs each switch closes. `methods` limits an entry to those HTTP methods. A switch stops new
 * use only: a member can still cancel a subscription, change or withdraw coach consent, delete coach history,
 * and read, rename or delete saved activities while it is off.
 */
export const FEATURE_ROUTES: Record<FeatureKey, ReadonlyArray<{ path: string; methods?: readonly string[] }>> = {
  // The page lands on /unavailable, which keeps the coach's data controls; /api/coach/{consent,data,status,threads} stay open.
  ai_coach: [{ path: "/ai-coach" }, { path: "/api/coach/chat" }, { path: "/api/coach/swap" }, { path: "/api/coach/actions" }],
  home_workout: [{ path: "/workouts/form-check" }, { path: "/home-workout" }],
  // Recording and importing; the activity list and each saved activity stay open.
  activity: [
    { path: "/activity/record" },
    { path: "/activity/walk" },
    { path: "/activity/run" },
    { path: "/activity/ride" },
    { path: "/activity/import" },
  ],
  // New checkouts only: /subscription stays open (cancel, payments, refunds) and hides its plans while off.
  subscriptions: [{ path: "/api/billing/checkout" }],
  support: [{ path: "/api/support", methods: ["POST"] }, { path: "/api/support/reply", methods: ["POST"] }],
};

/** The feature a request belongs to, or null. A path matches its entry and anything under it. */
export function featureForPath(pathname: string, method = "GET"): FeatureKey | null {
  const verb = method.toUpperCase();
  for (const key of FEATURE_KEYS) {
    for (const route of FEATURE_ROUTES[key]) {
      if (route.methods && !route.methods.includes(verb)) continue;
      if (pathname === route.path || pathname.startsWith(`${route.path}/`)) return key;
    }
  }
  return null;
}

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && (FEATURE_KEYS as readonly string[]).includes(value);
}

/** True while a maintenance notice should show: inside its window (an open end never ends). */
export function isMaintenanceLive(maintenance: Maintenance | null, now = Date.now()): boolean {
  if (!maintenance) return false;
  if (maintenance.startsAt && Date.parse(maintenance.startsAt) > now) return false;
  if (maintenance.endsAt && Date.parse(maintenance.endsAt) <= now) return false;
  return true;
}
