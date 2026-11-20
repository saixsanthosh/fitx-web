"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { logAdminEvent } from "@/lib/audit";
import { contentErrorMessage } from "@/lib/content/errors";
import { FOOD_ID, parseFoodForm, parsePortionsForm } from "@/lib/content/food-input";
import { text, type FormState } from "@/lib/content/form";
import { checkDeclaredFile, FOOD_MEDIA_BUCKET, isMediaPathFor, objectPathFromUrl, type MediaKind } from "@/lib/content/media-rules";
import { checkUploadedFile, createSignedUpload, removeFiles, supabaseProjectUrl } from "@/lib/content/storage";
import { logServerError } from "@/lib/log";
import { createAdminSupabase } from "@/lib/supabase/admin";

function refreshNutrition(foodId?: string) {
  revalidatePath("/nutrition");
  if (foodId) revalidatePath(`/nutrition/foods/${foodId}`);
}

/** Adds a food (no id) or saves one; for useActionState. A new food opens its page. */
export async function saveFood(foodId: string | null, _previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("nutrition.manage");
  if (foodId !== null && !FOOD_ID.test(foodId)) return { status: "error", message: "This food could not be found." };
  const parsed = parseFoodForm(formData, { creating: foodId === null });
  if (!parsed.ok) return { status: "error", message: "Check the fields marked in red.", fieldErrors: parsed.errors };
  const supabase = createAdminSupabase();
  if (!supabase) return { status: "error", message: "Server data access is not configured." };
  const { data, error } = await supabase.rpc("fitx_admin_op_save_food", { p_operator_id: actor.id, p_food_id: foodId, p_food: parsed.value });
  if (error) {
    if (!["22023", "P0002", "42501"].includes(error.code ?? "")) logServerError("nutrition.save_food", error);
    return { status: "error", message: contentErrorMessage(error) };
  }
  const id = typeof data === "string" ? data : foodId;
  refreshNutrition(id ?? undefined);
  if (foodId === null && id) redirect(`/nutrition/foods/${id}?state=created`);
  return { status: "saved", message: "Saved. Food search shows it from the next search." };
}

export async function setFoodActive(formData: FormData) {
  const actor = await requireAdmin("nutrition.manage");
  const foodId = formData.get("foodId");
  const active = formData.get("active");
  const back = formData.get("back") === "detail" && typeof foodId === "string" ? `/nutrition/foods/${foodId}` : "/nutrition";
  if (typeof foodId !== "string" || !FOOD_ID.test(foodId) || !["true", "false"].includes(String(active))) redirect("/nutrition?state=invalid");
  const supabase = createAdminSupabase();
  if (!supabase) redirect(`${back}?state=configuration`);
  const { error } = await supabase.rpc("fitx_admin_op_set_food_active", { p_operator_id: actor.id, p_food_id: foodId, p_is_active: active === "true" });
  if (error) {
    logServerError("nutrition.food_active", error);
    redirect(`${back}?state=${error.code === "42501" ? "forbidden" : "save_failed"}`);
  }
  refreshNutrition(foodId);
  redirect(`${back}?state=${active === "true" ? "shown" : "hidden"}`);
}

export async function saveFoodPortions(foodId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("nutrition.manage");
  if (!FOOD_ID.test(foodId)) return { status: "error", message: "This food could not be found." };
  const parsed = parsePortionsForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const supabase = createAdminSupabase();
  if (!supabase) return { status: "error", message: "Server data access is not configured." };
  const { error } = await supabase.rpc("fitx_admin_op_set_food_portions", { p_operator_id: actor.id, p_food_id: foodId, p_portions: parsed.value });
  if (error) {
    if (!["22023", "42501"].includes(error.code ?? "")) logServerError("nutrition.portions", error);
    return { status: "error", message: contentErrorMessage(error) };
  }
  refreshNutrition(foodId);
  return { status: "saved", message: parsed.value.length ? `${parsed.value.length} portions saved.` : "Portions removed. Members log it in grams." };
}

/** Step 1 of a photo upload: a one-time Storage address in the food's folder. */
export async function prepareFoodImageUpload(input: { ownerId: string; kind: MediaKind; type: string; size: number }) {
  await requireAdmin("nutrition.manage");
  if (!input || typeof input.ownerId !== "string" || !FOOD_ID.test(input.ownerId) || input.kind !== "food_photo") return { ok: false as const, message: "This upload is not valid." };
  const problem = checkDeclaredFile("food_photo", String(input.type), Number(input.size));
  if (problem) return { ok: false as const, message: problem };
  return createSignedUpload(FOOD_MEDIA_BUCKET, input.ownerId, "food_photo", String(input.type));
}

/** Step 2: checks the photo and sets it on the food with its credit. A replaced Admin upload is deleted. */
export async function finishFoodImageUpload(input: { ownerId: string; kind: MediaKind; path: string; alt: string; attribution: string; license: string }) {
  const actor = await requireAdmin("nutrition.manage");
  if (!input || typeof input.ownerId !== "string" || !FOOD_ID.test(input.ownerId) || input.kind !== "food_photo" || !isMediaPathFor(input.path, input.ownerId, "food_photo")) {
    return { ok: false as const, message: "This upload is not valid." };
  }
  const checked = await checkUploadedFile(FOOD_MEDIA_BUCKET, input.path, "food_photo");
  if (!checked.ok) {
    await logAdminEvent({ actor, action: "media_upload_refused", resourceType: "food", resourceId: input.ownerId, details: { kind: "food_photo" } });
    return checked;
  }
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false as const, message: "Server data access is not configured." };
  const { data, error } = await supabase.rpc("fitx_admin_op_set_food_image", {
    p_operator_id: actor.id,
    p_food_id: input.ownerId,
    p_image_url: checked.url,
    p_license: String(input.license ?? "").trim().slice(0, 120),
    p_attribution: String(input.attribution ?? "").trim().slice(0, 300),
  });
  if (error) {
    await removeFiles(FOOD_MEDIA_BUCKET, [input.path]);
    if (!["22023", "42501"].includes(error.code ?? "")) logServerError("nutrition.food_image", error);
    return { ok: false as const, message: contentErrorMessage(error) };
  }
  // A repeated finish for the same upload returns this same photo: it is in use, so it stays.
  if (data !== checked.url) await removeOldPhoto(data);
  refreshNutrition(input.ownerId);
  return { ok: true as const };
}

async function removeOldPhoto(previousUrl: unknown) {
  const base = supabaseProjectUrl();
  const path = typeof previousUrl === "string" && base ? objectPathFromUrl(previousUrl, base, FOOD_MEDIA_BUCKET) : null;
  if (path) await removeFiles(FOOD_MEDIA_BUCKET, [path]);
}

export async function removeFoodImage(formData: FormData) {
  const actor = await requireAdmin("nutrition.manage");
  const foodId = formData.get("foodId");
  if (typeof foodId !== "string" || !FOOD_ID.test(foodId)) redirect("/nutrition?state=invalid");
  const supabase = createAdminSupabase();
  if (!supabase) redirect(`/nutrition/foods/${foodId}?state=configuration`);
  const { data, error } = await supabase.rpc("fitx_admin_op_set_food_image", { p_operator_id: actor.id, p_food_id: foodId, p_image_url: null, p_license: null, p_attribution: null });
  if (error) {
    logServerError("nutrition.remove_image", error);
    redirect(`/nutrition/foods/${foodId}?state=${error.code === "42501" ? "forbidden" : "save_failed"}`);
  }
  await removeOldPhoto(data);
  refreshNutrition(foodId);
  redirect(`/nutrition/foods/${foodId}?state=photo_removed`);
}

export async function renameFoodCategory(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("nutrition.manage");
  const from = text(formData, "from", 200);
  const to = text(formData, "to", 200);
  if (!from || from.length > 120) return { status: "error", message: "Choose a category." };
  if (to.length > 120) return { status: "error", message: "Keep the new name under 120 characters." };
  const supabase = createAdminSupabase();
  if (!supabase) return { status: "error", message: "Server data access is not configured." };
  const { data, error } = await supabase.rpc("fitx_admin_op_rename_food_category", { p_operator_id: actor.id, p_from: from, p_to: to || null });
  if (error) {
    if (!["22023", "P0002", "42501"].includes(error.code ?? "")) logServerError("nutrition.rename_category", error);
    return { status: "error", message: contentErrorMessage(error) };
  }
  refreshNutrition();
  const moved = typeof data === "number" ? data : 0;
  return { status: "saved", message: to ? `${moved.toLocaleString("en-IN")} foods moved to “${to}”.` : `Category cleared on ${moved.toLocaleString("en-IN")} foods.` };
}
