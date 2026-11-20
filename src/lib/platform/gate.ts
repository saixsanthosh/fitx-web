import { NextResponse, type NextRequest } from "next/server";
import { featureForPath, parsePlatformSettings, PLATFORM_DEFAULTS, type PlatformSettings } from "./settings";

/** Settings are read at most once a minute per server instance; a failed read is retried after 15 seconds. */
export const PLATFORM_CACHE_MS = 60_000;
const FAILED_CACHE_MS = 15_000;
const READ_TIMEOUT_MS = 1500;

type Loaded = { settings: PlatformSettings; source: "database" | "defaults" };
let cached: { until: number; value: Loaded } | null = null;
let pending: Promise<Loaded> | null = null;

/** For tests: forget the cached settings. */
export function resetPlatformSettingsCache(): void {
  cached = null;
  pending = null;
}

async function fetchSettings(): Promise<Loaded> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { settings: PLATFORM_DEFAULTS, source: "defaults" };
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/platform_settings?id=eq.1&select=features,maintenance,site`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  // A missing table (before the migration) or any other refusal means the defaults: fail open.
  if (!response.ok) throw new Error(`platform settings ${response.status}`);
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows) || !rows.length) return { settings: PLATFORM_DEFAULTS, source: "database" };
  return { settings: parsePlatformSettings(rows[0]), source: "database" };
}

/**
 * The platform settings with where they came from: "database" once the platform_settings table answers,
 * else "defaults". Never throws: any failure gives the defaults (everything on).
 */
export async function loadPlatformSettings(): Promise<Loaded> {
  const now = Date.now();
  if (cached && cached.until > now) return cached.value;
  pending ??= fetchSettings()
    .then((value) => {
      cached = { until: Date.now() + PLATFORM_CACHE_MS, value };
      return value;
    })
    .catch(() => {
      const value: Loaded = { settings: PLATFORM_DEFAULTS, source: "defaults" };
      cached = { until: Date.now() + FAILED_CACHE_MS, value };
      return value;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** The settings alone (see loadPlatformSettings). */
export async function readPlatformSettings(): Promise<PlatformSettings> {
  return (await loadPlatformSettings()).settings;
}

/**
 * The one place a switched-off feature is enforced (src/proxy.ts calls it after its sign-in redirect): a page
 * is rewritten to /unavailable?feature=<key>, an API gets 503 { "error": "feature_unavailable" }. Null lets
 * the request through.
 */
export async function platformGate(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  const feature = featureForPath(pathname, request.method);
  if (!feature) return null;
  const settings = await readPlatformSettings();
  if (settings.features[feature]) return null;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "feature_unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  const target = new URL("/unavailable", request.url);
  target.searchParams.set("feature", feature);
  const response = NextResponse.rewrite(target);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
