"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { isUuid } from "@/lib/data/people";
import { logServerError } from "@/lib/log";
import { isMissingFunction, isPermissionError } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { isSupportPriority, isSupportStatus, SUPPORT_REPLY_MAX } from "@/lib/support-catalog";

function back(id: string, notice: string): never {
  redirect(`/support/${id}?notice=${notice}`);
}

function readRequestId(formData: FormData): string {
  const id = formData.get("requestId");
  if (!isUuid(id)) redirect("/support");
  return id.toLowerCase();
}

function failure(id: string, scope: string, error: { code?: string; message?: string }): never {
  if (isMissingFunction(error)) back(id, "migration");
  if (isPermissionError(error)) back(id, "forbidden");
  if (error.code === "P0002") redirect("/support?notice=not_found");
  logServerError(scope, error);
  back(id, "failed");
}

/** Replies as FITX Support and sets the status; the database writes the message and the audit row together. */
export async function replyToRequest(formData: FormData) {
  const actor = await requireAdmin("support.reply");
  const id = readRequestId(formData);
  const body = typeof formData.get("body") === "string" ? String(formData.get("body")).trim() : "";
  const status = formData.get("status");
  // Counted in characters (code points), as the database's char_length check counts them.
  if (!body || Array.from(body).length > SUPPORT_REPLY_MAX) back(id, "reply_length");
  if (!isSupportStatus(status)) back(id, "invalid");

  const admin = createAdminSupabase();
  if (!admin) back(id, "configuration");
  const { error } = await admin.rpc("fitx_admin_op_support_reply", { p_operator_id: actor.id, p_request_id: id, p_body: body, p_status: status });
  if (error) failure(id, "support.reply", error);
  revalidatePath(`/support/${id}`);
  revalidatePath("/support");
  back(id, "replied");
}

export async function updateRequest(formData: FormData) {
  const actor = await requireAdmin("support.reply");
  const id = readRequestId(formData);
  const status = formData.get("status");
  const priority = formData.get("priority");
  const assignee = formData.get("assignee");
  const seen = formData.get("seenUpdatedAt");
  if (!isSupportStatus(status) || !isSupportPriority(priority)) back(id, "invalid");
  if (assignee !== "" && !isUuid(assignee)) back(id, "invalid");
  const seenUpdatedAt = typeof seen === "string" && !Number.isNaN(Date.parse(seen)) ? seen : null;

  const admin = createAdminSupabase();
  if (!admin) back(id, "configuration");
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
    if (error.code === "40001") back(id, "changed");
    if (error.code === "22023") back(id, "assignee");
    failure(id, "support.update", error);
  }
  revalidatePath(`/support/${id}`);
  revalidatePath("/support");
  back(id, "updated");
}
