import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/account/admin";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { readPlatformSettings } from "@/lib/platform/gate";
import { readJsonObject } from "@/lib/security/body";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { bodyErrorResponse, rateLimitedResponse } from "@/lib/security/responses";
import { SOCIAL_BUCKET } from "@/lib/social/limits";
import { createRouteSupabase } from "@/lib/supabase/route-client";
import { answerVideoLinks } from "./handler";

const PRIVATE = { "Cache-Control": "private, no-store" };
/** Bursts only: the daily budget is the database's (40 plays a member, and the project's play bytes). */
const bursts = createRateLimiter({ limit: 30, windowMs: 60_000 });

/**
 * POST { paths } → { links: { [path]: signed URL } } for the Explore videos the signed-in member may play now, 429
 * social_link_budget when today's plays are spent, 503 social_unavailable while FITX has videos paused.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: PRIVATE });
  const route = createRouteSupabase(request);
  const admin = createAdminClient();
  if (!route || !admin) return NextResponse.json({ error: "social_unavailable" }, { status: 503, headers: PRIVATE });
  const { data } = await route.supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!userId) return route.applyTo(NextResponse.json({ error: "social_signed_out" }, { status: 401, headers: PRIVATE }));
  const burst = bursts.take(userId);
  if (!burst.allowed) return route.applyTo(rateLimitedResponse(burst.retryAfterSeconds));
  const body = await readJsonObject(request, 4096, { requireJsonType: true });
  if (!body.ok) return route.applyTo(bodyErrorResponse(body));

  const answer = await answerVideoLinks(body.value, {
    async switchedOn() {
      const { features } = await readPlatformSettings();
      return features.explore && features.explore_video;
    },
    async allowed(paths) {
      const { data: allowed, error } = await route.supabase.rpc("fitx_social_video_link_allowed", { p_paths: paths });
      if (error) throw error;
      return Array.isArray(allowed) ? allowed.filter((path): path is string => typeof path === "string") : [];
    },
    async sign(paths, seconds) {
      const { data: signed, error } = await admin.storage.from(SOCIAL_BUCKET).createSignedUrls(paths, seconds);
      if (error || !signed) throw error ?? new Error("no links");
      const links: Record<string, string> = {};
      for (const item of signed) if (item.path && item.signedUrl) links[item.path] = item.signedUrl;
      return links;
    },
  });
  return route.applyTo(NextResponse.json(answer.body, { status: answer.status, headers: PRIVATE }));
}
