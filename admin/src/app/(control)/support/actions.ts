"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SUPPORT_NOTICES } from "@/components/support/support-notices";
import { requireAdmin } from "@/lib/admin-auth";
import type { FormState } from "@/lib/content/form";
import { isUuid } from "@/lib/data/people";
import { logServerError } from "@/lib/log";
import { noticeHref } from "@/lib/notice";
import { isMissingFunction, isPermissionError } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { isSupportPriority, isSupportStatus, SUPPORT_REPLY_MAX } from "@/lib/support-catalog";

/** Back to the request with the result sealed for the operator who acted (lib/notice.ts). */
function back(actorId: string, id: string, notice: string): never {
  redirect(noticeHref(`/support/${id}`, notice, actorId));
}

function readRequestId(formData: FormData): string {
  const id = formData.get("requestId");
  if (!isUuid(id)) redirect("/support");
  return id.toLowerCase();
}

/** The code for a refused database call: a missing function, a role refusal, or "failed" (logged). Gone: to the inbox. */
function refusalCode(actorId: string, scope: string, error: { code?: string; message?: string }): string {
  if (isMissingFunction(error)) return "migration";
  if (isPermissionError(error)) return "forbidden";
  if (error.code === "P0002") redirect(noticeHref("/support", "not_found", actorId));
  logServerError(scope, error);
  return "failed";
}

function failure(actorId: string, id: string, scope: string, error: { code?: string; message?: string }): never {
  back(actorId, id, refusalCode(actorId, scope, error));
}

/** A refused reply as its form shows it, beside Send reply, with the reply kept as typed. */
function refusedReply(code: string, field?: string): FormState {
  const message = SUPPORT_NOTICES[code]?.text ?? SUPPORT_NOTICES.failed.text;
  return { status: "error", message, fieldErrors: field ? { [field]: message } : undefined };
}

/**
 * Replies as FITX Support and sets the status; the database writes the message and the audit row together. For
 * useActionState: a refusal comes back to the reply form, which keeps the reply as typed; a reply sent reloads the page.
 */
export async function replyToRequest(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("support.reply");
  const id = readRequestId(formData);
  const body = typeof formData.get("body") === "string" ? String(formData.get("body")).trim() : "";
  const status = formData.get("status");
  // Counted in characters (code points), as the database's char_length check counts them.
  if (!body || Array.from(body).length > SUPPORT_REPLY_MAX) return refusedReply("reply_length", "body");
  if (!isSupportStatus(status)) return refusedReply("invalid", "status");

  const admin = createAdminSupabase();
  if (!admin) return refusedReply("configuration");
  const { error } = await admin.rpc("fitx_admin_op_support_reply", { p_operator_id: actor.id, p_request_id: id, p_body: body, p_status: status });
  if (error) return refusedReply(refusalCode(actor.id, "support.reply", error));
  revalidatePath(`/support/${id}`);
  revalidatePath("/support");
  back(actor.id, id, "replied");
}

export async function updateRequest(formData: FormData) {
  const actor = await requireAdmin("support.reply");
  const id = readRequestId(formData);
  const status = formData.get("status");
  const priority = formData.get("priority");
  const assignee = formData.get("assignee");
  const seen = formData.get("seenUpdatedAt");
  if (!isSupportStatus(status) || !isSupportPriority(priority)) back(actor.id, id, "invalid");
  if (assignee !== "" && !isUuid(assignee)) back(actor.id, id, "invalid");
  const seenUpdatedAt = typeof seen === "string" && !Number.isNaN(Date.parse(seen)) ? seen : null;

  const admin = createAdminSupabase();
  if (!admin) back(actor.id, id, "configuration");
  const { error } = await admin.rpc("fitx_admin_op_support_update", {
    p_operator_id: actor.id,
    p_request_id: id,
    p_status: status,
    p_priority: priority,
    p_assigned_operator_id: assignee === "" ? null : assignee,
    // The request as the agent saw it; the database refuses the save if it changed since (40001).
    p_expected_updated_at: seenUpdatedAt,
  });
  if (error) {
    if (error.code === "40001") back(actor.id, id, "changed");
    if (error.code === "22023") back(actor.id, id, "assignee");
    failure(actor.id, id, "support.update", error);
  }
  revalidatePath(`/support/${id}`);
  revalidatePath("/support");
  back(actor.id, id, "updated");
}
