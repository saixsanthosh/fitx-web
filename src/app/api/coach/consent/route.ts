import type { NextRequest } from "next/server";
import { CoachError, unavailableError } from "@/lib/ai/coach";
import { buildCoachContext, loadContextSources } from "@/lib/ai/context";
import { coachGate, errorResponse, jsonResponse, readJsonBody } from "@/lib/ai/http";
import { getConsent, saveConsent, updateDataSharing, withdrawConsent } from "@/lib/ai/store";

/**
 * POST { shareData: boolean }: agree to the coach, or change "Use my FITX data" later.
 * DELETE: withdraw consent (conversations stay until the member deletes them).
 * Only accounts whose profile says 18 or over share their data with the coach, whatever the request says:
 * under-18 accounts and accounts without an age in their profile get "Questions only".
 */
export async function POST(request: NextRequest) {
  const access = await coachGate(request, { mutating: true });
  if (!access.ok) return access.response;
  const { gate } = access;
  const body = await readJsonBody(request, 500);
  if (!body || typeof body.shareData !== "boolean") return gate.finish(errorResponse(new CoachError("invalid", "Choose whether the coach may use your FITX data.")));
  try {
    const existing = await getConsent(gate.db, gate.userId);
    // A first consent only while the coach is on and set up: the consent screen names the AI services that get the
    // data, and a consent stored without it would skip that screen once keys are added. An existing consent can
    // still be changed (Coach settings works while the coach is paused or not set up).
    const unavailable = existing ? null : unavailableError(gate.config);
    if (unavailable) return gate.finish(errorResponse(unavailable));
    const { facts } = buildCoachContext(await loadContextSources(gate.db, gate.userId, new Date(), { full: false }));
    const shareData = body.shareData && facts.adult;
    if (existing) await updateDataSharing(gate.db, gate.userId, shareData);
    else await saveConsent(gate.db, gate.userId, shareData);
    return gate.finish(jsonResponse({ consent: { shareData } }));
  } catch (error) {
    return gate.finish(errorResponse(error));
  }
}

export async function DELETE(request: NextRequest) {
  const access = await coachGate(request, { mutating: true });
  if (!access.ok) return access.response;
  const { gate } = access;
  try {
    await withdrawConsent(gate.db, gate.userId);
    return gate.finish(jsonResponse({ consent: null }));
  } catch (error) {
    return gate.finish(errorResponse(error));
  }
}
