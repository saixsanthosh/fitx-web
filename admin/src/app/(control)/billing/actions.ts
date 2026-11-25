"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { contentErrorMessage } from "@/lib/content/errors";
import type { FormState } from "@/lib/content/form";
import { PLAN_CODE, parsePlanForm } from "@/lib/content/plan-input";
import { logServerError } from "@/lib/log";
import { noticeHref } from "@/lib/notice";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadPlan } from "@/lib/data/billing";

/**
 * Adds a plan (code null) or edits one; for useActionState. Prices and Razorpay plan ids that are set
 * never change here (Razorpay fixes the price on its plan). No call to Razorpay is made.
 */
export async function savePlan(code: string | null, _previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("billing.manage");
  let existing: { test: string | null; live: string | null } | undefined;
  if (code !== null) {
    if (!PLAN_CODE.test(code)) return { status: "error", message: "This plan could not be found." };
    const current = await loadPlan(code);
    if (current.state !== "ready") return { status: "error", message: "This plan could not be loaded. Nothing was changed." };
    existing = { test: current.plan.razorpayPlanIdTest, live: current.plan.razorpayPlanIdLive };
  }
  const parsed = parsePlanForm(formData, { creating: code === null, existing });
  if (!parsed.ok) return { status: "error", message: "Check the fields marked in red.", fieldErrors: parsed.errors };
  if (code !== null && parsed.code !== code) return { status: "error", message: "A plan's code cannot change." };
  const supabase = createAdminSupabase();
  if (!supabase) return { status: "error", message: "Server data access is not configured." };
  if (code === null) {
    const taken = await supabase.from("billing_plans").select("code").eq("code", parsed.code).maybeSingle();
    if (taken.data) return { status: "error", message: "Check the fields marked in red.", fieldErrors: { code: "That code is taken." } };
  }
  const { error } = await supabase.rpc("fitx_admin_op_save_billing_plan", { p_operator_id: actor.id, p_code: parsed.code, p_plan: parsed.value });
  if (error) {
    if (!["22023", "23505", "FXC04", "42501"].includes(error.code ?? "")) logServerError("billing.save_plan", error);
    return { status: "error", message: contentErrorMessage(error) };
  }
  revalidatePath("/billing");
  if (code === null) redirect(noticeHref(`/billing/plans/${parsed.code}`, "created", actor.id, { param: "state" }));
  return { status: "saved", message: "Plan saved. The FITX subscription page shows it from the next visit." };
}
