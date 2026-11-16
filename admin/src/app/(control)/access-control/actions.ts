"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function setAdminMember(formData: FormData) {
  const { user, role } = await requireAdmin();
  if (role !== "super_admin") redirect("/access-control?state=forbidden");
  const userId = formData.get("userId");
  const memberRole = formData.get("role");
  const active = formData.get("active");
  if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) redirect("/access-control?state=invalid");
  if (memberRole !== "admin" && memberRole !== "super_admin") redirect("/access-control?state=invalid");
  if (active !== "true" && active !== "false") redirect("/access-control?state=invalid");

  const supabase = createAdminSupabase();
  if (!supabase) redirect("/access-control?state=configuration");
  const { data: target, error: lookupError } = await supabase.auth.admin.getUserById(userId);
  if (lookupError || !target.user) redirect("/access-control?state=user_not_found");
  const { error } = await supabase.rpc("fitx_admin_set_member", {
    p_actor_id: user.id,
    p_user_id: userId,
    p_role: memberRole,
    p_is_active: active === "true",
  });
  if (error) redirect(`/access-control?state=${error.code === "42501" ? "forbidden" : "save_failed"}`);
  revalidatePath("/access-control");
  revalidatePath("/audit");
  redirect("/access-control?state=saved");
}
