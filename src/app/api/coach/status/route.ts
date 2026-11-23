import type { NextRequest } from "next/server";
import { coachGate, errorResponse, jsonResponse } from "@/lib/ai/http";
import { coachStatus } from "@/lib/ai/status";
import { readPlatformSettings } from "@/lib/platform/gate";

/**
 * GET: whether the coach is ready for this member, today's limits and their conversations. This route stays open while
 * FITX Admin switches the AI coach off (the coach's data controls need it), so it reports "paused" then, as for
 * AI_COACH_ENABLED=false: the chat, swap and actions APIs are closed (src/lib/platform/settings.ts FEATURE_ROUTES).
 */
export async function GET(request: NextRequest) {
  const access = await coachGate(request, { mutating: false });
  if (!access.ok) return access.response;
  const { gate } = access;
  try {
    const switchedOn = (await readPlatformSettings()).features.ai_coach;
    return gate.finish(jsonResponse(await coachStatus(gate.db, gate.userId, switchedOn ? gate.config : { ...gate.config, enabled: false })));
  } catch (error) {
    return gate.finish(errorResponse(error));
  }
}
