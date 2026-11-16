import type { NextRequest } from "next/server";
import { coachGate, errorResponse, jsonResponse } from "@/lib/ai/http";
import { listThreads } from "@/lib/ai/store";

/** GET: the member's coach conversations, newest first. */
export async function GET(request: NextRequest) {
  const access = await coachGate(request, { mutating: false });
  if (!access.ok) return access.response;
  const { gate } = access;
  try {
    return gate.finish(jsonResponse({ threads: await listThreads(gate.db, gate.userId) }));
  } catch (error) {
    return gate.finish(errorResponse(error));
  }
}
