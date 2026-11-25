"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { logAdminEvent } from "@/lib/audit";
import { contentErrorMessage } from "@/lib/content/errors";
import { EXERCISE_ID, parseExerciseForm } from "@/lib/content/exercise-input";
import type { FormState } from "@/lib/content/form";
import { checkDeclaredFile, EXERCISE_MEDIA_BUCKET, isMediaPathFor, type MediaKind } from "@/lib/content/media-rules";
import { checkUploadedFile, createSignedUpload, removeFiles } from "@/lib/content/storage";
import { logServerError } from "@/lib/log";
import { noticeHref } from "@/lib/notice";
import { createAdminSupabase } from "@/lib/supabase/admin";

/** To `path` with the result sealed for the operator who acted (lib/notice.ts); the page shows its own words for it. */
function to(actorId: string, path: string, state: string): never {
  redirect(noticeHref(path, state, actorId, { param: "state" }));
}

const PROGRAMME_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function refreshTraining(exerciseId?: string) {
  revalidatePath("/training");
  revalidatePath("/overview");
  if (exerciseId) revalidatePath(`/training/exercises/${exerciseId}`);
}

export async function setExerciseActive(formData: FormData) {
  const actor = await requireAdmin("content.manage");
  const exerciseId = formData.get("exerciseId");
  const active = formData.get("active");
  const back = formData.get("back") === "detail" && typeof exerciseId === "string" ? `/training/exercises/${exerciseId}` : "/training";
  if (typeof exerciseId !== "string" || !EXERCISE_ID.test(exerciseId) || !["true", "false"].includes(String(active))) {
    to(actor.id, "/training", "invalid");
  }
  const supabase = createAdminSupabase();
  if (!supabase) to(actor.id, back, "configuration");
  const { error } = await supabase.rpc("fitx_admin_op_set_exercise_active", {
    p_operator_id: actor.id,
    p_exercise_id: exerciseId,
    p_is_active: active === "true",
  });
  if (error) to(actor.id, back, error.code === "42501" ? "forbidden" : "save_failed");
  refreshTraining(exerciseId);
  to(actor.id, back, active === "true" ? "shown" : "hidden");
}

/** Adds an exercise (no id) or saves one; for useActionState. A new exercise opens its page. */
export async function saveExercise(exerciseId: string | null, _previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("content.manage");
  if (exerciseId !== null && !EXERCISE_ID.test(exerciseId)) return { status: "error", message: "This exercise could not be found." };
  const parsed = parseExerciseForm(formData, { creating: exerciseId === null });
  if (!parsed.ok) return { status: "error", message: "Check the fields marked in red.", fieldErrors: parsed.errors };
  const supabase = createAdminSupabase();
  if (!supabase) return { status: "error", message: "Server data access is not configured." };
  const { data, error } = await supabase.rpc("fitx_admin_op_save_exercise", { p_operator_id: actor.id, p_exercise_id: exerciseId, p_exercise: parsed.value });
  if (error) {
    if (!["22023", "23505", "P0002", "42501"].includes(error.code ?? "")) logServerError("training.save_exercise", error);
    return { status: "error", message: contentErrorMessage(error), fieldErrors: error.code === "23505" ? { name: "An exercise with this name exists." } : undefined };
  }
  const id = typeof data === "string" ? data : exerciseId;
  refreshTraining(id ?? undefined);
  if (exerciseId === null && id) to(actor.id, `/training/exercises/${id}`, "created");
  return { status: "saved", message: "Saved. Members see it the next time the page loads." };
}

/** Deletes an Admin-made exercise that nothing uses, with its uploaded files. */
export async function deleteExercise(formData: FormData) {
  const actor = await requireAdmin("content.manage");
  const exerciseId = formData.get("exerciseId");
  if (typeof exerciseId !== "string" || !EXERCISE_ID.test(exerciseId)) to(actor.id, "/training", "invalid");
  const supabase = createAdminSupabase();
  if (!supabase) to(actor.id, `/training/exercises/${exerciseId}`, "configuration");
  const { data, error } = await supabase.rpc("fitx_admin_op_delete_exercise", { p_operator_id: actor.id, p_exercise_id: exerciseId });
  if (error) {
    const state = error.code === "FXC01" ? "in_use" : error.code === "FXC02" ? "catalogue" : error.code === "42501" ? "forbidden" : "delete_failed";
    if (state === "delete_failed") logServerError("training.delete_exercise", error);
    to(actor.id, `/training/exercises/${exerciseId}`, state);
  }
  await removeFiles(EXERCISE_MEDIA_BUCKET, Array.isArray(data) ? data.filter((path): path is string => typeof path === "string") : []);
  refreshTraining();
  to(actor.id, "/training", "deleted");
}

type UploadKind = Extract<MediaKind, "still" | "video_loop">;
const isUploadKind = (value: unknown): value is UploadKind => value === "still" || value === "video_loop";

/** Step 1 of an upload: a one-time Storage address for a new file in the exercise's folder. */
export async function prepareExerciseUpload(input: { ownerId: string; kind: MediaKind; type: string; size: number }) {
  await requireAdmin("content.manage");
  if (!input || typeof input.ownerId !== "string" || !EXERCISE_ID.test(input.ownerId) || !isUploadKind(input.kind)) {
    return { ok: false as const, message: "This upload is not valid." };
  }
  const problem = checkDeclaredFile(input.kind, String(input.type), Number(input.size));
  if (problem) return { ok: false as const, message: problem };
  return createSignedUpload(EXERCISE_MEDIA_BUCKET, input.ownerId, input.kind, String(input.type));
}

/** Step 2: checks the uploaded file, then records it so the app shows it. A refused file is deleted. */
export async function finishExerciseUpload(input: { ownerId: string; kind: MediaKind; path: string; alt: string; attribution: string; license: string; width: number | null; height: number | null }) {
  const actor = await requireAdmin("content.manage");
  if (!input || typeof input.ownerId !== "string" || !EXERCISE_ID.test(input.ownerId) || !isUploadKind(input.kind) || !isMediaPathFor(input.path, input.ownerId, input.kind)) {
    return { ok: false as const, message: "This upload is not valid." };
  }
  const checked = await checkUploadedFile(EXERCISE_MEDIA_BUCKET, input.path, input.kind);
  if (!checked.ok) {
    await logAdminEvent({ actor, action: "media_upload_refused", resourceType: "exercise", resourceId: input.ownerId, details: { kind: input.kind } });
    return checked;
  }
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false as const, message: "Server data access is not configured." };
  const dimension = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 10000 ? value : null);
  const { error } = await supabase.rpc("fitx_admin_op_add_exercise_media", {
    p_operator_id: actor.id,
    p_exercise_id: input.ownerId,
    p_kind: input.kind,
    p_storage_path: input.path,
    p_alt: String(input.alt ?? "").trim().slice(0, 300),
    p_attribution: String(input.attribution ?? "").trim().slice(0, 200),
    p_license: String(input.license ?? "").trim().slice(0, 120),
    p_width: dimension(input.width),
    p_height: dimension(input.height),
  });
  if (error) {
    // 23505: this path is already recorded, so the file is in use and stays.
    if (error.code !== "23505") await removeFiles(EXERCISE_MEDIA_BUCKET, [input.path]);
    if (!["22023", "FXC03", "42501", "23505"].includes(error.code ?? "")) logServerError("training.add_media", error);
    return { ok: false as const, message: contentErrorMessage(error) };
  }
  refreshTraining(input.ownerId);
  return { ok: true as const };
}

export async function removeExerciseMedia(formData: FormData) {
  const actor = await requireAdmin("content.manage");
  const exerciseId = formData.get("exerciseId");
  const mediaId = formData.get("mediaId");
  if (typeof exerciseId !== "string" || !EXERCISE_ID.test(exerciseId) || typeof mediaId !== "string" || !MEDIA_ID.test(mediaId)) to(actor.id, "/training", "invalid");
  const supabase = createAdminSupabase();
  if (!supabase) to(actor.id, `/training/exercises/${exerciseId}`, "configuration");
  const { data, error } = await supabase.rpc("fitx_admin_op_remove_exercise_media", { p_operator_id: actor.id, p_media_id: mediaId });
  if (error) {
    logServerError("training.remove_media", error);
    to(actor.id, `/training/exercises/${exerciseId}`, error.code === "42501" ? "forbidden" : "save_failed");
  }
  if (typeof data === "string") await removeFiles(EXERCISE_MEDIA_BUCKET, [data]);
  refreshTraining(exerciseId);
  to(actor.id, `/training/exercises/${exerciseId}`, "media_removed");
}

export async function setProgrammeStatus(formData: FormData) {
  const actor = await requireAdmin("content.manage");
  const programmeId = formData.get("programmeId");
  const status = formData.get("status");
  if (typeof programmeId !== "string" || !PROGRAMME_ID.test(programmeId) || (status !== "draft" && status !== "published")) to(actor.id, "/training?tab=programmes", "invalid");
  const supabase = createAdminSupabase();
  if (!supabase) to(actor.id, "/training?tab=programmes", "configuration");
  const { error } = await supabase.rpc("fitx_admin_op_set_programme_status", { p_operator_id: actor.id, p_programme_id: programmeId, p_status: status });
  if (error) {
    logServerError("training.programme_status", error);
    to(actor.id, "/training?tab=programmes", error.code === "42501" ? "forbidden" : "save_failed");
  }
  revalidatePath("/training");
  to(actor.id, `/training?tab=programmes#${programmeId}`, status === "published" ? "programme_published" : "programme_draft");
}
