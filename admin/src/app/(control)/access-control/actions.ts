"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { isUuid } from "@/lib/data/people";
import { createOperator, resetOperatorPassword, updateOperator, type OperatorError } from "@/lib/operators";

function done(state: "saved" | "created" | "password_reset" | OperatorError | "invalid" | "confirm_needed"): never {
  revalidatePath("/access-control");
  redirect(`/access-control?state=${state}`);
}

function readOperatorId(formData: FormData): string {
  const id = formData.get("operatorId");
  if (!isUuid(id)) done("invalid");
  return id.toLowerCase();
}

/** Adds an operator with a temporary password; they choose their own at first sign-in. */
export async function addOperator(formData: FormData) {
  const actor = await requireAdmin("access.manage");
  const result = await createOperator(actor, {
    username: formData.get("username"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  revalidatePath("/audit");
  done(result.ok ? "created" : result.error);
}

/** Changes another operator's role or status. Lowering access or switching someone off needs the box ticked. */
export async function changeOperator(formData: FormData) {
  const actor = await requireAdmin("access.manage");
  const id = readOperatorId(formData);
  const active = formData.get("active");
  if (active !== "true" && active !== "false") done("invalid");
  if (formData.get("confirm") !== "yes") done("confirm_needed");
  const result = await updateOperator(actor, id, { role: formData.get("role"), isActive: active === "true" });
  revalidatePath("/audit");
  done(result.ok ? "saved" : result.error);
}

/** Gives another operator a new temporary password and signs them out everywhere. */
export async function resetPassword(formData: FormData) {
  const actor = await requireAdmin("access.manage");
  const id = readOperatorId(formData);
  if (formData.get("confirm") !== "yes") done("confirm_needed");
  const result = await resetOperatorPassword(actor, id, formData.get("password"));
  revalidatePath("/audit");
  done(result.ok ? "password_reset" : result.error);
}
