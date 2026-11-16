import type { NextRequest } from "next/server";
import { CoachError, applyProposal } from "@/lib/ai/coach";
import { coachGate, errorResponse, jsonResponse, readJsonBody } from "@/lib/ai/http";
import { dismissAction } from "@/lib/ai/store";
import { isUuid } from "@/lib/ai/validate";

/**
 * POST { op: "apply" | "dismiss" } for one coach proposal.
 * "apply" is "Add to My Food Plan" (one custom food, never a logged meal) or "Save as a workout
 * draft". The values come from the proposal FITX stored and checked, never from this request.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await coachGate(request, { mutating: true });
  if (!access.ok) return access.response;
  const { gate } = access;
  const { id } = await context.params;
  const body = await readJsonBody(request, 500);
  const op = body?.op;
  if (!isUuid(id) || (op !== "apply" && op !== "dismiss")) return gate.finish(errorResponse(new CoachError("invalid", "Unknown request.")));
  try {
    if (op === "dismiss") {
      await dismissAction(gate.db, gate.userId, id);
      return gate.finish(jsonResponse({ status: "dismissed" }));
    }
    const applied = await applyProposal(gate.db, gate.userId, id);
    return gate.finish(jsonResponse({ status: "applied", kind: applied.kind, refId: applied.refId, already: applied.already }));
  } catch (error) {
    return gate.finish(errorResponse(error));
  }
}
