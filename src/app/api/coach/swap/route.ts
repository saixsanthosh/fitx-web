import type { NextRequest } from "next/server";
import { CoachError, runSwap } from "@/lib/ai/coach";
import { coachDeps, coachGate, errorResponse, jsonResponse, readJsonBody } from "@/lib/ai/http";
import { cleanText, isUuid } from "@/lib/ai/validate";

export const maxDuration = 60;

/** POST { actionId, note? }: "Can't afford this?" for one food in a meal plan. */
export async function POST(request: NextRequest) {
  const access = await coachGate(request, { mutating: true });
  if (!access.ok) return access.response;
  const { gate } = access;
  const body = await readJsonBody(request, 2_000);
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
