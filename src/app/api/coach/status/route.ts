import type { NextRequest } from "next/server";
import { coachGate, errorResponse, jsonResponse } from "@/lib/ai/http";
import { coachStatus } from "@/lib/ai/status";

/** GET: whether the coach is ready for this member, today's limits and their conversations. */
export async function GET(request: NextRequest) {
  const access = await coachGate(request, { mutating: false });
  if (!access.ok) return access.response;
  const { gate } = access;
  try {
    return gate.finish(jsonResponse(await coachStatus(gate.db, gate.userId, gate.config)));
  } catch (error) {
    return gate.finish(errorResponse(error));
  }
}
