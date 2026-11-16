import { redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createUserSupabase } from "@/lib/supabase/server";
import { isAdminRole, type AdminRole } from "@/lib/roles";

type Membership = { role: AdminRole; is_active: boolean };
export type MembershipState =
  | { state: "ready"; membership: Membership }
  | { state: "setup_pending" | "not_authorized" | "service_key_missing" };

function isMissingAdminSchema(code: string | undefined) {
  return code === "42P01" || code === "PGRST205" || code === "PGRST204";
}

export async function readMembership(userId: string): Promise<MembershipState> {
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const { data, error } = await admin
    .from("fitx_admin_members")
    .select("role,is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { state: isMissingAdminSchema(error.code) ? "setup_pending" : "not_authorized" };
  if (!data || !data.is_active || !isAdminRole(data.role)) return { state: "not_authorized" };
  return { state: "ready", membership: { role: data.role, is_active: data.is_active } };
}

export async function requireAdmin() {
  const supabase = await createUserSupabase();
  if (!supabase) redirect("/access?state=configuration");

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/signin");

  const membership = await readMembership(user.id);
  if (membership.state !== "ready") {
    redirect(`/access?state=${membership.state}`);
  }

  return { user, role: membership.membership.role };
}
