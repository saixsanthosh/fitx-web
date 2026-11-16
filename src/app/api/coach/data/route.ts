import type { NextRequest } from "next/server";
import { coachGate, errorResponse, jsonResponse } from "@/lib/ai/http";
import { deleteAllCoachData } from "@/lib/ai/store";

/**
 * DELETE: "Delete my coach data". Removes every conversation, message and proposal, and the consent.
 * Foods and workouts the member already added stay in Nutrition and Workouts.
 */
export async function DELETE(request: NextRequest) {
  const access = await coachGate(request, { mutating: true });
  if (!access.ok) return access.response;
  const { gate } = access;
  try {
    const result = await deleteAllCoachData(gate.db);
    return gate.finish(jsonResponse({ deleted: true, threads: result.threads }));
  } catch (error) {
    return gate.finish(errorResponse(error));
  }
}
