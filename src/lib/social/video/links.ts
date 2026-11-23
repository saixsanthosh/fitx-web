/**
 * Signed links to Explore videos, asked for only when a member taps play (posters cost no play budget). Another
 * member's video is signed by /api/social/video-links, which counts it against the member's and the project's daily
 * budget first; the member's own videos are signed directly with their own key (the bucket lets them read their own
 * files). Links are kept for most of their life, so playing a video twice costs one play.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SocialError, toSocialError } from "../errors";
import { SOCIAL_BUCKET } from "../limits";

/** How long a signed video link lives (the route signs for this long). */
export const VIDEO_LINK_SECONDS = 30 * 60;
const KEEP_MS = (VIDEO_LINK_SECONDS - 5 * 60) * 1000;
export const VIDEO_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9]\.mp4$/;

const cache = new Map<string, { url: string | null; until: number }>();

export function forgetVideoLinks(paths?: readonly string[]) {
  if (!paths) cache.clear();
  else for (const path of paths) cache.delete(path);
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** The route's answer as a SocialError (social_link_budget, social_unavailable, rate_limited and the rest). */
export async function linkError(response: Response): Promise<SocialError> {
  let body: { error?: unknown; hint?: unknown } = {};
  try {
    body = await response.json();
  } catch {
    // An empty or HTML answer: fall through to the status.
  }
  const key = typeof body.error === "string" && body.error.startsWith("social_") ? body.error
    : response.status === 503 ? "social_unavailable" : response.status === 429 ? "rate_limited" : response.status === 401 ? "social_signed_out" : "failed";
  return toSocialError({ message: key, code: key === "rate_limited" ? "PT429" : undefined, hint: typeof body.hint === "string" ? body.hint : undefined });
}

/**
 * A signed link for one video `path`, or null when the member may not play it (or it is gone). Throws a SocialError
 * when the play budget is spent (social_link_budget) or videos are paused (social_unavailable).
 */
export async function videoLink(
  path: string,
  { ownerId, viewerId, db, fetcher = fetch, now = Date.now() }: { ownerId: string; viewerId: string; db: Pick<SupabaseClient, "storage"> | null; fetcher?: Fetcher; now?: number },
): Promise<string | null> {
  if (!VIDEO_PATH.test(path)) return null;
  const kept = cache.get(path);
  if (kept && kept.until > now) return kept.url;
  let url: string | null = null;
  if (ownerId === viewerId && db) {
    const { data, error } = await db.storage.from(SOCIAL_BUCKET).createSignedUrl(path, VIDEO_LINK_SECONDS);
    if (error) throw toSocialError(error);
    url = data?.signedUrl ?? null;
  } else {
    const response = await fetcher("/api/social/video-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ paths: [path] }),
    });
    if (!response.ok) throw await linkError(response);
    const body = (await response.json()) as { links?: Record<string, string> };
    url = typeof body.links?.[path] === "string" ? body.links[path] : null;
  }
  cache.set(path, { url, until: now + (url ? KEEP_MS : 30_000) });
  return url;
}
