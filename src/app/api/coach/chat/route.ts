import type { NextRequest } from "next/server";
import { CoachError, MESSAGE_MAX, runCoachTurn } from "@/lib/ai/coach";
import { coachDeps, coachGate, errorResponse, ndjsonResponse, readJsonBody } from "@/lib/ai/http";
import { cleanMultiline, cleanText, isUuid, oneOf } from "@/lib/ai/validate";

// A plan can take two model attempts plus food checks; this fits Vercel's Hobby limit too.
export const maxDuration = 60;

/**
 * POST { message, threadId?, mode?: "chat" | "meal_plan" | "workout_plan", budget? }
 * Streams NDJSON events (thread, task, status, delta, reset, message, done, error). Errors found
 * before anything starts (sign-in, consent, limits, coach switched off) come back as JSON with a
 * matching status code instead.
 */
export async function POST(request: NextRequest) {
  const access = await coachGate(request, { mutating: true });
  if (!access.ok) return access.response;
  const { gate } = access;

  const body = await readJsonBody(request, 8_000);
  const message = cleanMultiline(body?.message, MESSAGE_MAX + 1);
  const mode = body?.mode === undefined ? "chat" : oneOf(body.mode, ["chat", "meal_plan", "workout_plan"] as const);
  const threadId = body?.threadId === undefined || body?.threadId === null ? null : isUuid(body.threadId) ? body.threadId : undefined;
  if (!body || !message || message.length > MESSAGE_MAX || !mode || threadId === undefined) {
    return gate.finish(errorResponse(new CoachError("invalid", `Write a message of up to ${MESSAGE_MAX} characters.`)));
  }
  const budgetNote = cleanText(body.budget, 60);

  return ndjsonResponse(request, gate, (emit, signal) => runCoachTurn(coachDeps(gate, signal), { threadId, message, mode, budgetNote }, emit));
}
