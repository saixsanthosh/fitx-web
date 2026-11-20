// Platform settings as Admin edits them. No imports, so tests can load it. The same keys and limits are in
// src/lib/platform/settings.ts (what the app reads; tests/platform/settings.test.ts keeps the two equal) and
// in fitx_admin_op_save_platform_settings (supabase/migrations/20261121100033_fitx_admin_ops.sql).

/** The migration that adds platform settings, targeted notices, the support inbox and the security summary. */
export const ADMIN_OPS_MIGRATION = "20261121100033_fitx_admin_ops";

export const FEATURE_KEYS = ["ai_coach", "home_workout", "activity", "subscriptions", "support"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, { label: string; hint: string }> = {
  ai_coach: { label: "AI coach", hint: "Chat page and its API" },
  home_workout: { label: "Home workout", hint: "Camera workouts at home" },
  activity: { label: "Activity", hint: "Walk, run and ride tracking" },
  subscriptions: { label: "Subscriptions", hint: "Plans page and new checkouts" },
  support: { label: "Help messages", hint: "New messages and replies from Help" },
};

/** The site's own contact details when nothing is saved (src/config/brand.ts; a test keeps them equal). */
export const SITE_DEFAULTS = { supportEmail: "saisanthosh5369@gmail.com", instagramUrl: "https://www.instagram.com/saixsanthosh/" } as const;

export const MAINTENANCE_LIMITS = { title: 120, body: 600 } as const;

export type Maintenance = { title: string; body: string; startsAt: string | null; endsAt: string | null };
export type SiteInfo = { supportEmail: string; instagramUrl: string };
export type PlatformSettingsValue = { features: Record<FeatureKey, boolean>; maintenance: Maintenance | null; site: SiteInfo };

const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[A-Za-z]{2,}$/;
const INSTAGRAM = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?$/;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim() : "";
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** A stored row as Admin shows it: every switch on unless saved off, the site's defaults when empty. */
export function parseSettingsRow(row: unknown): PlatformSettingsValue & { updatedAt: string | null } {
  const source = record(row);
  const features = record(source.features);
  const maintenance = record(source.maintenance);
  const site = record(source.site);
  const title = text(maintenance.title);
  const body = text(maintenance.body);
  return {
    features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, features[key] !== false])) as Record<FeatureKey, boolean>,
    maintenance: source.maintenance && title && body ? { title, body, startsAt: isoOrNull(maintenance.startsAt), endsAt: isoOrNull(maintenance.endsAt) } : null,
    site: {
      supportEmail: typeof site.supportEmail === "string" && EMAIL.test(site.supportEmail) ? site.supportEmail : SITE_DEFAULTS.supportEmail,
      instagramUrl: typeof site.instagramUrl === "string" && INSTAGRAM.test(site.instagramUrl) ? site.instagramUrl : SITE_DEFAULTS.instagramUrl,
    },
    updatedAt: typeof source.updated_at === "string" ? source.updated_at : null,
  };
}

/**
 * The settings form's fields, checked as the database checks them. `startsAt`/`endsAt` are ISO times
 * already converted from the IST form fields (null when empty; undefined when the field was not a time).
 */
export function validateSettingsInput(input: {
  features: Partial<Record<FeatureKey, boolean>>;
  maintenanceOn: boolean;
  maintenanceTitle: unknown;
  maintenanceBody: unknown;
  startsAt: string | null | undefined;
  endsAt: string | null | undefined;
  supportEmail: unknown;
  instagramUrl: unknown;
}): { ok: true; value: PlatformSettingsValue } | { ok: false; error: string } {
  const features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, input.features[key] === true])) as Record<FeatureKey, boolean>;
  let maintenance: Maintenance | null = null;
  if (input.maintenanceOn) {
    const title = text(input.maintenanceTitle);
    const body = text(input.maintenanceBody);
    if (Array.from(title).length < 3 || Array.from(title).length > MAINTENANCE_LIMITS.title) return { ok: false, error: `The notice title needs 3 to ${MAINTENANCE_LIMITS.title} characters.` };
    if (!body || Array.from(body).length > MAINTENANCE_LIMITS.body) return { ok: false, error: `The notice needs 1 to ${MAINTENANCE_LIMITS.body} characters.` };
    if (input.startsAt === undefined || input.endsAt === undefined) return { ok: false, error: "Enter the times as a date and time (IST), or leave them empty." };
    if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) return { ok: false, error: "The end must be after the start." };
    maintenance = { title, body, startsAt: input.startsAt, endsAt: input.endsAt };
  }
  const supportEmail = text(input.supportEmail);
  const instagramUrl = text(input.instagramUrl);
  if (!EMAIL.test(supportEmail) || supportEmail.length > 254) return { ok: false, error: "Enter a support email address." };
  if (!INSTAGRAM.test(instagramUrl)) return { ok: false, error: "Use an Instagram address such as https://www.instagram.com/name/." };
  return { ok: true, value: { features, maintenance, site: { supportEmail, instagramUrl } } };
}

/** Whether a maintenance notice shows now, later, or is over. */
export function maintenanceTiming(maintenance: Maintenance | null, now = Date.now()): "off" | "live" | "scheduled" | "ended" {
  if (!maintenance) return "off";
  if (maintenance.endsAt && Date.parse(maintenance.endsAt) <= now) return "ended";
  if (maintenance.startsAt && Date.parse(maintenance.startsAt) > now) return "scheduled";
  return "live";
}
