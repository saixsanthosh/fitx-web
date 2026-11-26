"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { logServerWarning } from "@/lib/log";
import { noticeHref, SIGN_IN_NOTICE } from "@/lib/notice";
import { changeOwnPassword, type OperatorError } from "@/lib/operators";

/**
 * A refused change as the Account page can word it. The database's refusals are mapped for every kind of operator
 * change (lib/operators.ts); one about a role, a username or another operator, or a missing operator row, cannot be
 * told apart from a failure here, so it reads as one (and is logged) instead of showing nothing.
 */
function ownPasswordRefusal(error: OperatorError) {
  if (error === "wrong_password") return "wrong_password";
  if (error === "locked") return "locked";
  if (error === "weak_password") return "weak_password";
  if (error === "same_password") return "same_password";
  if (error === "root_protected") return "root_protected";
  if (error === "unavailable") return "unavailable";
  if (error !== "failed") logServerWarning("account.change_password", `refused as ${error}`);
  return "failed";
}

/** Changes your own password (needs only a session, so a temporary password can be replaced). */
export async function changePassword(formData: FormData) {
  const actor = await requireAdmin();
  const next = formData.get("next_password");
  if (next !== formData.get("confirm_password")) redirect(noticeHref("/account", "mismatch", actor.id, { param: "state" }));
  const result = await changeOwnPassword(actor, formData.get("current_password"), next, { headers: await headers() });
  // The password changed but this browser could not be signed in again: say so on /login (sealed: nobody is signed in there).
  if (result.ok && !result.signedIn) redirect(noticeHref("/login", "password_changed", SIGN_IN_NOTICE, { param: "state" }));
  redirect(noticeHref("/account", result.ok ? "changed" : ownPasswordRefusal(result.error), actor.id, { param: "state" }));
}
