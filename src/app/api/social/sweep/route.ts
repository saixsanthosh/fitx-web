import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/account/admin";
import { bearerMatches, noStore } from "@/lib/billing/http";
import { SOCIAL_BUCKET } from "@/lib/social/limits";
import { chunks, isMissing, runSweep, SWEEP, type SweepDeps } from "./sweep";

export const maxDuration = 60;

/**
 * The daily Explore storage sweep, called by Vercel Cron (vercel.json, once a day: the Hobby plan allows no more) with
 * "Authorization: Bearer $CRON_SECRET". The hourly database job (fitx-social-hourly) keeps deleting expired stories
 * and queueing files every hour; this removes the queued files through the Storage API with the server key
 * (SUPABASE_SECRET_KEY). It can also be run by hand with the same header.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() || null;
  if (!secret) return noStore({ error: "cron_secret_missing" }, 503);
  if (!bearerMatches(request.headers.get("authorization"), secret)) return noStore({ error: "unauthorized" }, 401);
  const admin = createAdminClient();
  if (!admin) return noStore({ error: "sweep_not_configured" }, 503);
  try {
    const summary = await runSweep(sweepDeps(admin));
    return noStore(summary);
  } catch (error) {
    console.error(`[fitx-social] sweep failed: ${error instanceof Error ? error.message : "error"}`);
    return noStore({ error: "sweep_failed" }, 500);
  }
}

const REFERENCES: ReadonlyArray<readonly [table: string, column: string]> = [
  ["social_post_media", "storage_path"], ["social_post_media", "poster_path"], ["social_stories", "storage_path"],
  ["social_stories", "poster_path"], ["social_profiles", "avatar_path"], ["social_communities", "cover_path"],
];

function sweepDeps(admin: SupabaseClient): SweepDeps {
  const fail = (what: string, error: { message?: string; code?: string }) => new Error(`${what}: ${error.code ?? ""} ${error.message ?? ""}`.trim());
  return {
    async hourly() {
      const { data, error } = await admin.rpc("fitx_social_hourly");
      if (error) {
        if (isMissing(error)) return null;
        throw fail("hourly", error);
      }
      return (data ?? null) as Record<string, unknown> | null;
    },
    async trash(limit) {
      const { data, error } = await admin.from("social_storage_trash").select("path, reason").order("queued_at", { ascending: true }).limit(limit);
      if (error) {
        if (isMissing(error)) return null;
        throw fail("trash", error);
      }
      return (data ?? []) as { path: string; reason: string }[];
    },
    async referenced(paths) {
      const found = new Set<string>();
      for (const part of chunks(paths, SWEEP.checkChunk)) {
        for (const [table, column] of REFERENCES) {
          const { data, error } = await admin.from(table).select(column).in(column, part);
          if (error) {
            if (isMissing(error)) continue;
            throw fail("references", error);
          }
          for (const row of (data ?? []) as unknown as Record<string, unknown>[]) if (typeof row[column] === "string") found.add(row[column] as string);
        }
      }
      return found;
    },
    async remove(paths) {
      for (const part of chunks(paths, SWEEP.pageSize)) {
        const { error } = await admin.storage.from(SOCIAL_BUCKET).remove(part);
        if (error) throw fail("remove", error as { message?: string });
      }
    },
    async forget(paths) {
      for (const part of chunks(paths, SWEEP.checkChunk)) {
        const { error } = await admin.from("social_storage_trash").delete().in("path", part);
        if (error) throw fail("forget", error);
      }
    },
    now: () => Date.now(),
  };
}
