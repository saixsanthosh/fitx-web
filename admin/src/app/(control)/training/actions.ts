"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function setExerciseActive(formData: FormData) {
  const actor = await requireAdmin("content.manage");
  const exerciseId = formData.get("exerciseId");
  const active = formData.get("active");
  if (typeof exerciseId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(exerciseId) || !["true", "false"].includes(String(active))) {
    redirect("/training?state=invalid");
  }
  const supabase = createAdminSupabase();
  if (!supabase) redirect("/training?state=configuration");
  const { error } = await supabase.rpc("fitx_admin_op_set_exercise_active", {
    p_operator_id: actor.id,
    p_exercise_id: exerciseId,
    p_is_active: active === "true",
  });
  if (error) redirect(`/training?state=${error.code === "42501" ? "forbidden" : "save_failed"}`);
  revalidatePath("/training");
  revalidatePath("/overview");
  redirect("/training?state=saved");
}
