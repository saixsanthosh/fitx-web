"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { revokeOperatorSessions, revokeSessionById } from "@/lib/admin-session";
import { logAdminEvent } from "@/lib/audit";
import { isUuid } from "@/lib/data/people";
import { createAdminSupabase } from "@/lib/supabase/admin";

function done(state: string): never {
  revalidatePath("/security");
  redirect(`/security?state=${state}`);
}

/** Ends one Admin session: your own, or anyone's with access.manage (the owner's only by the owner). */
export async function endSession(formData: FormData) {
  const actor = await requireAdmin("security.view");
  const id = formData.get("sessionId");
  if (!isUuid(id)) done("invalid");
  if (id === actor.sessionId) done("current");
  const result = await revokeSessionById(actor, id);
  done(result.ok ? "ended" : result.error);
}

/** Ends every open session of another operator (access.manage). The owner's sessions only by the owner. */
export async function endOperatorSessions(formData: FormData) {
  const actor = await requireAdmin("security.view");
  if (!hasPermission(actor, "access.manage")) done("forbidden");
  const operatorId = formData.get("operatorId");
  if (!isUuid(operatorId)) done("invalid");
  if (operatorId === actor.id) done("self");
  const admin = createAdminSupabase();
  if (!admin) done("failed");
  const target = await admin.from("admin_operators").select("id,is_root").eq("id", operatorId).maybeSingle();
  if (target.error || !target.data) done(target.error ? "failed" : "not_found");
  if (target.data.is_root && !actor.isRoot) done("forbidden");
  const ended = await revokeOperatorSessions(operatorId, "ended_by_operator");
  await logAdminEvent({ actor, action: "admin_sessions_revoked", resourceType: "admin_operator", resourceId: operatorId, details: { sessions_ended: ended } });
  done("ended_all");
}
