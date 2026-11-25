import { NextResponse } from "next/server";
import { SUPPORT_RATE, supportLimitBody, supportWait, type SupportSendKind } from "@/components/support/support-rules";
import { rateLimitedResponse } from "@/lib/security/responses";
import type { createClient } from "@/lib/supabase/server";

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * The 429 for a message the database's limit refused (PT429; its detail names "hour" or "day"): which limit it is and
 * when the next message can go, worked out from the person's own recent messages, which row-level security lets them
 * read. If those can't be read, the answer still names the limit, with no time.
 */
export async function supportLimitResponse(supabase: Supabase, kind: SupportSendKind, detail: unknown) {
  const now = Date.now();
  const times = await ownRecentTimes(supabase, kind, now).catch(() => []);
  const wait = supportWait(kind, times, now, detail === "day" ? "day" : "hour");
  const body = supportLimitBody(kind, wait.window, wait.at, now);
  // Whole seconds, rounded up: rateLimitedResponse rounds to the nearest, which could ask for a retry half a second early.
  return wait.at !== null ? rateLimitedResponse(Math.ceil((wait.at - now) / 1000), body) : NextResponse.json(body, { status: 429, headers: { "Cache-Control": "private, no-store" } });
}

async function ownRecentTimes(supabase: Supabase, kind: SupportSendKind, now: number): Promise<string[]> {
  const { data, error } = kind === "reply"
    ? await supabase.from("support_messages").select("created_at").eq("author_kind", "user").gt("created_at", new Date(now - HOUR_MS).toISOString())
      .order("created_at", { ascending: false }).limit(SUPPORT_RATE.repliesPerHour)
    : await supabase.from("support_requests").select("created_at").gt("created_at", new Date(now - DAY_MS).toISOString())
      .order("created_at", { ascending: false }).limit(SUPPORT_RATE.requestsPerDay);
  if (error || !Array.isArray(data)) return [];
  return (data as Array<{ created_at?: unknown }>).flatMap((row) => (typeof row.created_at === "string" ? [row.created_at] : []));
}
