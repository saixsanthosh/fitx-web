import "server-only";
import { cookies } from "next/headers";
import { logServerError } from "@/lib/log";
import type { createUserSupabase } from "@/lib/supabase/server";

type UserSupabase = Awaited<ReturnType<typeof createUserSupabase>>;

/**
 * Ends only this browser's Admin session. Admin and the FITX customer site share one
 * Supabase project, so the default global scope would also sign the person out of
 * FITX on every device. Only use this in a Server Action or Route Handler.
 */
export async function signOutLocally(supabase: UserSupabase) {
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (!error) return;
    logServerError("auth.sign_out", error);
  }

  // If Supabase could not be reached, still remove this browser's session cookies.
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (name.startsWith("sb-")) cookieStore.delete(name);
  }
}
