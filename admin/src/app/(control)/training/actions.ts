"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function setExerciseActive(formData: FormData) {
  const { user } = await requireAdmin();
  const exerciseId = formData.get("exerciseId");
  const active = formData.get("active");
  if (typeof exerciseId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(exerciseId) || !["true", "false"].includes(String(active))) {
    redirect("/training?state=invalid");
  }
  const supabase = createAdminSupabase();
  if (!supabase) redirect("/training?state=configuration");
  const { error } = await supabase.rpc("fitx_admin_set_exercise_active", {
    p_actor_id: user.id,
    p_exercise_id: exerciseId,
    p_is_active: active === "true",
  });
  if (error) redirect("/training?state=save_failed");
  revalidatePath("/training");
  revalidatePath("/overview");
  redirect("/training?state=saved");
}
