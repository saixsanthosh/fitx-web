import type { NextRequest } from "next/server";
import { CoachError, runSwap } from "@/lib/ai/coach";
import { coachDeps, coachGate, errorResponse, jsonResponse } from "@/lib/ai/http";
import { cleanText, isUuid } from "@/lib/ai/validate";
import { readJsonObjectOrNull } from "@/lib/security/body";
import { takeRouteLimit } from "@/lib/security/rate-limit";

export const maxDuration = 60;

/** POST { actionId, note? }: "Can't afford this?" for one food in a meal plan. */
export async function POST(request: NextRequest) {
  const access = await coachGate(request, { mutating: true });
  if (!access.ok) return access.response;
  const { gate } = access;
  // Bursts stop here, before any model call; the daily allowance is the coach's database quota.
  const burst = takeRouteLimit("coachTurn", gate.userId);
  if (!burst.allowed) {
    const retryAt = new Date(Date.now() + burst.retryAfterSeconds * 1000).toISOString();
    return gate.finish(errorResponse(new CoachError("quota", "You’re sending messages quickly. Wait a moment.", retryAt)));
  }
  const body = await readJsonObjectOrNull(request, 2_000);
  if (!body || !isUuid(body.actionId) || (body.note !== undefined && body.note !== null && typeof body.note !== "string")) {
    return gate.finish(errorResponse(new CoachError("invalid", "Choose a food from your plan.")));
  }
  try {
    const result = await runSwap(coachDeps(gate, request.signal), { actionId: body.actionId, note: cleanText(body.note, 200) });
    return gate.finish(jsonResponse(result));
  } catch (error) {
    return gate.finish(errorResponse(error));
  }
}
