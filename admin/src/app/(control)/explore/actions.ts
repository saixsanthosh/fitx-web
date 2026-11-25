"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exploreNotice, refusalField } from "@/components/explore/notices";
import { requireAdmin } from "@/lib/admin-auth";
import type { FormState } from "@/lib/content/form";
import { userIdForUsername } from "@/lib/data/explore";
import { isUuid } from "@/lib/data/people";
import {
  COVER_MAX_BYTES,
  coverPath,
  isAction,
  isReason,
  isSanctionKind,
  isSuspensionLength,
  moderationNotice,
  NEEDS_REASON,
  suspensionUntil,
  validateChallenge,
  validateCommunity,
  validateTemplate,
} from "@/lib/explore-rules";
import { logServerError } from "@/lib/log";
import { noticeHref } from "@/lib/notice";
import { isMissingSchema } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

const BUCKET = "social-media";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** To `path` with the result sealed for the operator who acted (lib/notice.ts): the page shows Explore's own words for it. */
function go(actorId: string, path: string, notice: string): never {
  redirect(noticeHref(path, notice, actorId));
}

/** The code for a refused database call ("migration", a known explore_* refusal, or "failed", which is logged). */
function refusalCode(scope: string, error: { code?: string; message?: string }): string {
  if (isMissingSchema(error)) return "migration";
  const notice = moderationNotice(error);
  if (notice === "failed") logServerError(scope, error);
  return notice;
}

function failure(actorId: string, path: string, scope: string, error: { code?: string; message?: string }): never {
  go(actorId, path, refusalCode(scope, error));
}

/** A refused form, kept as typed: Admin's own words beside its button, and the field they are about. */
function refused(code: string): FormState {
  const field = refusalField(code);
  const message = exploreNotice(code)?.text ?? "That did not complete. The server log has the details.";
  return { status: "error", message, fieldErrors: field ? { [field]: message } : undefined };
}

function invalid(check: { error: string; field: string }): FormState {
  return { status: "error", message: check.error, fieldErrors: { [check.field]: check.error } };
}

/** Removes files through the Storage API (a SQL delete would orphan them); they also wait in the sweep's trash. */
async function removeFiles(admin: NonNullable<ReturnType<typeof createAdminSupabase>>, paths: unknown): Promise<boolean> {
  const list = Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string" && path.length > 0) : [];
  if (!list.length) return true;
  const { error } = await admin.storage.from(BUCKET).remove(list);
  if (error) {
    logServerError("explore.remove_files", error);
    return false;
  }
  return true;
}

/** What a moderation or a moderator change came to: the page it goes back to and a result code; `done` when it happened. */
type Outcome = { back: string; code: string; done: boolean };

/**
 * One moderation action from a report page (reportId) or the account record (userId, member actions only). The
 * database checks explore.moderate again, closes the reports, tells the reporters and audits, in one transaction.
 */
async function runModeration(actorId: string, formData: FormData): Promise<Outcome> {
  const reportId = field(formData, "reportId");
  const userId = field(formData, "userId");
  if (!isUuid(reportId) && !isUuid(userId)) redirect("/explore");
  const back = isUuid(reportId) ? `/explore/reports/${reportId.toLowerCase()}` : `/explore/accounts/${userId.toLowerCase()}`;
  const refuse = (code: string): Outcome => ({ back, code, done: false });
  const action = field(formData, "action");
  if (!isAction(action)) return refuse("invalid_action");
  const reason = field(formData, "reason");
  if (reason && !isReason(reason)) return refuse("invalid_reason");
  if (NEEDS_REASON.includes(action) && !reason) return refuse("reason_required");
  const note = field(formData, "note").slice(0, 1000);
  const sanction = field(formData, "sanction") || "explore";
  if (!isSanctionKind(sanction)) return refuse("invalid_sanction");
  const length = field(formData, "length") || "7d";
  if (action === "suspend" && !isSuspensionLength(length)) return refuse("invalid_until");

  const admin = createAdminSupabase();
  if (!admin) return refuse("configuration");
  const { data, error } = await admin.rpc("fitx_admin_op_moderate", {
    p_operator_id: actorId,
    p_report_id: isUuid(reportId) ? reportId.toLowerCase() : null,
    p_action: action,
    p_reason_code: reason || null,
    p_note: note || null,
    p_until: action === "suspend" && isSuspensionLength(length) ? suspensionUntil(length) : null,
    p_sanction: sanction,
    p_user: isUuid(reportId) ? null : userId.toLowerCase(),
  });
  if (error) return refuse(refusalCode("explore.moderate", error));
  const removed = await removeFiles(admin, (data as { paths?: unknown } | null)?.paths);
  revalidatePath("/explore");
  revalidatePath(back);
  return { back, code: removed ? `done_${action}` : "files_pending", done: true };
}

/** A moderation from a form with nothing typed in it (the irreversible actions, suspend, lift): every result goes back sealed. */
export async function moderate(formData: FormData) {
  const actor = await requireAdmin("explore.moderate");
  const outcome = await runModeration(actor.id, formData);
  go(actor.id, outcome.back, outcome.code);
}

/**
 * The reversible actions, with their reason and note, for useActionState: a refusal (the report was closed by someone
 * else, the content is gone, a failure) comes back beside the buttons and the form keeps the reason and the note as
 * typed (BUGS.md 63); an action that happened goes back with a sealed result.
 */
export async function moderateKept(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("explore.moderate");
  const outcome = await runModeration(actor.id, formData);
  if (!outcome.done) return refused(outcome.code);
  go(actor.id, outcome.back, outcome.code);
}

/**
 * Saves a community's details and, when one was chosen, its cover (a WebP made in the browser); for useActionState.
 * A refusal comes back to the form, which keeps what was typed; a save opens the community's page.
 */
export async function saveCommunity(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("explore.moderate");
  const existing = field(formData, "id");
  const id = isUuid(existing) ? existing.toLowerCase() : crypto.randomUUID();
  const checked = validateCommunity({ slug: formData.get("slug"), name: formData.get("name"), description: formData.get("description"), visibility: formData.get("visibility") });
  if (!checked.ok) return invalid(checked);
  const admin = createAdminSupabase();
  if (!admin) return refused("configuration");

  const cover = formData.get("cover");
  const removeCover = formData.get("remove_cover") === "on";
  let coverValue: string | null = removeCover ? "" : null;
  let uploaded = false;
  if (cover instanceof File && cover.size > 0) {
    const bytes = new Uint8Array(await cover.arrayBuffer());
    const webp = bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (!webp || cover.size > COVER_MAX_BYTES) return refused("cover_invalid");
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(coverPath(id), bytes, { contentType: "image/webp", upsert: true, cacheControl: "3600" });
    if (uploadError) {
      logServerError("explore.cover_upload", uploadError);
      return refused("cover_failed");
    }
    coverValue = coverPath(id);
    uploaded = true;
  }

  const { error } = await admin.rpc("fitx_admin_op_save_community", {
    p_operator_id: actor.id,
    p_id: id,
    p_slug: checked.value.slug,
    p_name: checked.value.name,
    p_description: checked.value.description,
    p_visibility: checked.value.visibility,
    p_cover_path: coverValue,
  });
  if (error) {
    // A new community that was refused leaves no cover behind.
    if (uploaded && !isUuid(existing)) await removeFiles(admin, [coverPath(id)]);
    return refused(refusalCode("explore.save_community", error));
  }
  if (removeCover) await removeFiles(admin, [coverPath(id)]);
  revalidatePath("/explore/communities");
  revalidatePath(`/explore/communities/${id}`);
  go(actor.id, `/explore/communities/${id}`, "saved");
}

/** Makes a member (by Explore username, or a listed moderator by ID) a moderator, or a moderator a member again. */
async function runCommunityRole(actorId: string, formData: FormData, role: string): Promise<Outcome> {
  const community = field(formData, "communityId");
  if (!isUuid(community)) redirect("/explore/communities");
  const back = `/explore/communities/${community.toLowerCase()}`;
  const refuse = (code: string): Outcome => ({ back, code, done: false });
  if (role !== "moderator" && role !== "member") return refuse("invalid_role");
  const admin = createAdminSupabase();
  if (!admin) return refuse("configuration");
  const given = field(formData, "userId");
  const userId = isUuid(given) ? given.toLowerCase() : await userIdForUsername(field(formData, "username"));
  // Not looked up (logged): that says nothing about the username, so the form does not mark it.
  if (userId === undefined) return refuse("failed");
  if (!userId) return refuse("unknown_username");
  const { error } = await admin.rpc("fitx_admin_op_set_community_role", { p_operator_id: actorId, p_community: community.toLowerCase(), p_user: userId, p_role: role });
  if (error) return refuse(refusalCode("explore.community_role", error));
  revalidatePath(back);
  return { back, code: role === "moderator" ? "moderator_added" : "moderator_removed", done: true };
}

/** The moderator list's Remove buttons (role and member in hidden fields): every result goes back sealed. */
export async function setCommunityRole(formData: FormData) {
  const actor = await requireAdmin("explore.moderate");
  const outcome = await runCommunityRole(actor.id, formData, field(formData, "role"));
  go(actor.id, outcome.back, outcome.code);
}

/**
 * Add moderator, for useActionState: a refusal (no Explore profile has that username, not an accepted adult member, a
 * failure) comes back beside the button with the username kept, and marked when it is about the username (BUGS.md
 * 63); an appointment goes back with a sealed result.
 */
export async function addModerator(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("explore.moderate");
  const outcome = await runCommunityRole(actor.id, formData, "moderator");
  if (!outcome.done) return refused(outcome.code);
  go(actor.id, outcome.back, outcome.code);
}

/**
 * Adds or edits a challenge; its window is the IST week or month of the day chosen. For useActionState: a refusal
 * comes back to the form, which keeps what was typed.
 */
export async function saveChallenge(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("explore.moderate");
  const existing = field(formData, "id");
  const back = "/explore/challenges";
  const checked = validateChallenge({
    kind: field(formData, "kind"), title: formData.get("title"), metric: field(formData, "metric"), sport: formData.get("sport"),
    target: formData.get("target"), day: field(formData, "day"), communityId: formData.get("community"),
  });
  if (!checked.ok) return invalid(checked);
  const admin = createAdminSupabase();
  if (!admin) return refused("configuration");
  const v = checked.value;
  const { error } = await admin.rpc("fitx_admin_op_save_challenge", {
    p_operator_id: actor.id, p_id: isUuid(existing) ? existing.toLowerCase() : null, p_kind: v.kind, p_title: v.title, p_metric: v.metric,
    p_sport: v.sport, p_target: v.target, p_starts_at: v.startsAt, p_ends_at: v.endsAt, p_community_id: v.communityId,
  });
  if (error) return refused(refusalCode("explore.save_challenge", error));
  revalidatePath(back);
  go(actor.id, back, "challenge_saved");
}

/** Closes a challenge now (the groups file's final sync runs first when it is applied). */
export async function closeChallenge(formData: FormData) {
  const actor = await requireAdmin("explore.moderate");
  const id = field(formData, "id");
  const back = "/explore/challenges";
  if (!isUuid(id)) go(actor.id, back, "challenge_not_found");
  const admin = createAdminSupabase();
  if (!admin) go(actor.id, back, "configuration");
  const { error } = await admin.rpc("fitx_admin_op_close_challenge", { p_operator_id: actor.id, p_id: id.toLowerCase() });
  if (error) failure(actor.id, back, "explore.close_challenge", error);
  revalidatePath(back);
  go(actor.id, back, "challenge_closed_now");
}

/** Adds or edits a template the hourly tick opens challenges from. For useActionState, as saveChallenge. */
export async function saveTemplate(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin("explore.moderate");
  const existing = field(formData, "id");
  const back = "/explore/challenges";
  const checked = validateTemplate({
    kind: field(formData, "kind"), title: formData.get("title"), metric: field(formData, "metric"), sport: formData.get("sport"),
    target: formData.get("target"), active: formData.get("active") === "on",
  });
  if (!checked.ok) return invalid(checked);
  const admin = createAdminSupabase();
  if (!admin) return refused("configuration");
  const v = checked.value;
  const { error } = await admin.rpc("fitx_admin_op_save_challenge_template", {
    p_operator_id: actor.id, p_id: isUuid(existing) ? existing.toLowerCase() : null, p_kind: v.kind, p_title: v.title, p_metric: v.metric,
    p_sport: v.sport, p_target: v.target, p_active: v.active,
  });
  if (error) return refused(refusalCode("explore.save_template", error));
  revalidatePath(back);
  go(actor.id, back, "template_saved");
}
