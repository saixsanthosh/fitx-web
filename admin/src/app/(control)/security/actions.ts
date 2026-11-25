"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { revokeOperatorSessions, revokeSessionById } from "@/lib/admin-session";
import { logAdminEvent } from "@/lib/audit";
import { isUuid } from "@/lib/data/people";
import { noticeHref } from "@/lib/notice";
import { createAdminSupabase } from "@/lib/supabase/admin";

/** Back to Security with the result sealed for the operator who acted (lib/notice.ts). */
function done(actorId: string, state: string): never {
  revalidatePath("/security");
  redirect(noticeHref("/security", state, actorId, { param: "state" }));
}

/** Ends one Admin session: your own, or anyone's with access.manage (the owner's only by the owner). */
export async function endSession(formData: FormData) {
  const actor = await requireAdmin("security.view");
  const id = formData.get("sessionId");
  if (!isUuid(id)) done(actor.id, "invalid");
  if (id === actor.sessionId) done(actor.id, "current");
  const result = await revokeSessionById(actor, id);
  done(actor.id, result.ok ? "ended" : result.error);
}

/** Ends every open session of another operator (access.manage). The owner's sessions only by the owner. */
export async function endOperatorSessions(formData: FormData) {
  const actor = await requireAdmin("security.view");
  if (!hasPermission(actor, "access.manage")) done(actor.id, "forbidden");
  const operatorId = formData.get("operatorId");
  if (!isUuid(operatorId)) done(actor.id, "invalid");
  if (operatorId === actor.id) done(actor.id, "self");
  const admin = createAdminSupabase();
  if (!admin) done(actor.id, "failed");
  const target = await admin.from("admin_operators").select("id,is_root").eq("id", operatorId).maybeSingle();
  if (target.error || !target.data) done(actor.id, target.error ? "failed" : "not_found");
  if (target.data.is_root && !actor.isRoot) done(actor.id, "forbidden");
  const ended = await revokeOperatorSessions(operatorId, "ended_by_operator");
  await logAdminEvent({ actor, action: "admin_sessions_revoked", resourceType: "admin_operator", resourceId: operatorId, details: { sessions_ended: ended } });
  done(actor.id, "ended_all");
}
