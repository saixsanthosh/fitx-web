import type { NextRequest } from "next/server";
import { CoachError } from "@/lib/ai/coach";
import { coachGate, errorResponse, jsonResponse } from "@/lib/ai/http";
import { deleteThread, loadThreadView } from "@/lib/ai/store";
import { isUuid } from "@/lib/ai/validate";

type Context = { params: Promise<{ id: string }> };

/** GET: one conversation with its messages and the status of each proposal. */
export async function GET(request: NextRequest, context: Context) {
  const access = await coachGate(request, { mutating: false });
  if (!access.ok) return access.response;
  const { gate } = access;
  const { id } = await context.params;
  if (!isUuid(id)) return gate.finish(errorResponse(new CoachError("not_found", "That conversation doesn't exist.")));
  try {
    const view = await loadThreadView(gate.db, gate.userId, id);
    if (!view) return gate.finish(errorResponse(new CoachError("not_found", "That conversation doesn't exist.")));
    return gate.finish(jsonResponse(view));
  } catch (error) {
    return gate.finish(errorResponse(error));
  }
}

/** DELETE: removes one conversation, its messages and proposals. Foods already added stay. */
export async function DELETE(request: NextRequest, context: Context) {
  const access = await coachGate(request, { mutating: true });
  if (!access.ok) return access.response;
  const { gate } = access;
  const { id } = await context.params;
  if (!isUuid(id)) return gate.finish(errorResponse(new CoachError("not_found", "That conversation doesn't exist.")));
  try {
    await deleteThread(gate.db, gate.userId, id);
    return gate.finish(jsonResponse({ deleted: true }));
  } catch (error) {
    return gate.finish(errorResponse(error));
  }
}
