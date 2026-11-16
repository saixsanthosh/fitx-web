import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { createRouteSupabase } from "@/lib/supabase/route-client";
import { loadCatalogThumbnails, parseCatalogSearchParams, searchCatalog } from "@/lib/training/catalog-search";

/**
 * GET /api/exercises: one page of the exercise library, for signed-in users.
 *
 * Query (all optional; unknown keys are ignored, bad values dropped, numbers clamped):
 *   q             name search; every word must appear in the name
 *   muscle_group  a taxonomy muscle group     category    a taxonomy category
 *   difficulty    beginner|intermediate|advanced
 *   location      home|gym (the exercise's derived locations)
 *   equipment     one equipment key the exercise uses
 *   doable        comma-separated equipment keys the user has, already expanded; empty = none
 *   ids           comma-separated exercise ids (at most 100), for saved and recent exercises
 *   sort          name|difficulty             page        1-based    pageSize   default 24, max 48
 *
 * Answer: { items, total, page, pageSize, curated }. Items are light CatalogExercise objects (no
 * description or instructions) plus `thumbnail`, the first photo's URL or null. `curated` is false
 * until the catalogue clean-up migration has run; the estimated filters are then approximate.
 * Reads use the caller's session, so row-level security applies (merged duplicates are hidden).
 */
export async function GET(request: NextRequest) {
  const route = createRouteSupabase(request);
  if (!route) return reply({ error: "The exercise library is not connected in this environment." }, 503);

  const { data, error } = await route.supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!userId) {
    const outage = Boolean(error) && (isAuthRetryableFetchError(error) || (typeof error?.status === "number" && error.status >= 500));
    return route.applyTo(outage
      ? reply({ error: "Your session could not be checked right now. Try again in a moment." }, 503)
      : reply({ error: "Sign in to browse the exercise library." }, 401));
  }

  const params = parseCatalogSearchParams(request.nextUrl.searchParams);
  const outcome = await searchCatalog(route.supabase, params);
  if (outcome.error) {
    console.warn("FITX exercise search failed", codeOf(outcome.error));
    return route.applyTo(reply({ error: "The exercise library could not be loaded. Check your connection and try again." }, 502));
  }

  const media = await loadCatalogThumbnails(route.supabase, outcome.exercises, SUPABASE_URL);
  if (media.error) console.warn("FITX exercise thumbnails fell back to the pinned photos", codeOf(media.error));
  return route.applyTo(reply({
    items: outcome.exercises.map((exercise) => ({ ...exercise, thumbnail: media.thumbnails.get(exercise.id) ?? null })),
    total: outcome.total,
    page: params.page,
    pageSize: params.pageSize,
    curated: outcome.curated,
  }, 200));
}

function reply(body: unknown, status: number) {
  // Read with the user's session: the browser may reuse a page briefly (Back, returning to a
  // filter), shared caches must not store it. Errors are never reused.
  return NextResponse.json(body, { status, headers: { "Cache-Control": status === 200 ? "private, max-age=60" : "private, no-store" } });
}

function codeOf(error: unknown) {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
  return typeof code === "string" && code ? code : "unknown";
}
