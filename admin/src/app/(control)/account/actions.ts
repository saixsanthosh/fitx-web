"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { changeOwnPassword } from "@/lib/operators";

/** Changes your own password (needs only a session, so a temporary password can be replaced). */
export async function changePassword(formData: FormData) {
  const actor = await requireAdmin();
  const next = formData.get("next_password");
  if (next !== formData.get("confirm_password")) redirect("/account?state=mismatch");
  const result = await changeOwnPassword(actor, formData.get("current_password"), next, { headers: await headers() });
  // The password changed but this browser could not be signed in again: say so on /login.
  if (result.ok && !result.signedIn) redirect("/login?state=password_changed");
  redirect(`/account?state=${result.ok ? "changed" : result.error}`);
}
