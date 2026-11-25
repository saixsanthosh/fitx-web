// What the Explore screens say after an action, in Admin's own fixed words: the result sealed into ?notice= by the
// Server Action that redirects (lib/notice.ts), or the refusal a form shows beside its button. Never text from the
// address. Imports only explore-rules, so tests can load it.

import { EXPLORE_MIGRATION } from "@/lib/explore-rules";

export type ExploreNotice = { tone: "success" | "error"; text: string };

const DONE: Record<string, string> = {
  done_dismiss: "Report dismissed. The reporter was told FITX reviewed it.",
  done_claim: "You took this report for review.",
  done_limit: "Limited: only the owner and their followers see it now. The reports are closed.",
  done_hide: "Hidden: only the owner sees it, marked Hidden by FITX. The reports are closed.",
  done_unhide: "Shown again to everyone who could see it before.",
  done_remove: "Removed, with its files. The reports are closed.",
  done_clear_avatar: "Profile photo cleared.",
  done_clear_bio: "Bio cleared.",
  done_warn: "Warning sent. The member sees it as a notice in the app.",
  done_suspend: "Suspended. The member reads why and can still delete their content.",
  done_lift: "Suspension lifted.",
  saved: "Saved.",
  moderator_added: "Moderator added.",
  moderator_removed: "Moderator removed.",
  challenge_saved: "Challenge saved. Members' values are counted from their own workouts and activities.",
  challenge_closed_now: "Challenge closed.",
  template_saved: "Template saved.",
};

const ERRORS: Record<string, string> = {
  forbidden: "Your role can look at Explore but not change it.",
  migration: `This needs migration ${EXPLORE_MIGRATION}.`,
  configuration: "Server data access is not configured.",
  failed: "That did not complete. The server log has the details.",
  files_pending: "Done, but some files could not be removed yet. The nightly clean-up removes them.",
  report_not_found: "That report no longer exists.",
  content_gone: "The content is gone (its owner deleted it, or it was removed). Dismiss the report instead.",
  member_not_found: "That account no longer exists, or has no Explore profile.",
  no_member: "This report names no member.",
  no_sanction: "There is no active suspension of that kind.",
  report_closed: "This report is already closed.",
  report_required: "That action needs a report.",
  action_not_for_target: "That action does not apply to this kind of report.",
  invalid_action: "Choose an action.",
  invalid_reason: "Choose a reason from the list.",
  reason_required: "Choose a reason first.",
  invalid_note: "The note can have at most 1,000 characters.",
  invalid_sanction: "Choose what to suspend.",
  invalid_until: "Choose 7 days, 30 days or until lifted.",
  invalid_slug: "The address needs 3 to 40 lower-case letters, digits or dashes.",
  invalid_name: "The name needs 1 to 60 characters.",
  invalid_description: "The description can have at most 500 characters.",
  invalid_visibility: "Choose public or private.",
  invalid_cover: "The cover could not be saved.",
  slug_taken: "Another community already uses that address.",
  cover_invalid: "The cover must be a WebP picture under 900 KB. Choose the picture again.",
  cover_failed: "The cover could not be uploaded. Nothing was saved.",
  community_not_found: "That community no longer exists.",
  not_member: "Only accepted members can be moderators.",
  not_adult: "Moderators must be 18 or over.",
  unknown_username: "No Explore profile has that username.",
  invalid_role: "Choose moderator or member.",
  invalid_kind: "Choose weekly or monthly.",
  invalid_title: "The title needs 1 to 80 characters.",
  invalid_metric: "Choose what the challenge counts.",
  invalid_sport: "A sport applies only to distance and active minutes.",
  invalid_target: "The target must be above 0.",
  invalid_window: "Choose a week or month that has not ended.",
  invalid_active: "Choose whether the template is on.",
  challenge_closed: "That challenge is already closed.",
  challenge_not_found: "That challenge no longer exists.",
};

/** The words for a result code, or null for no code or one Explore does not have. */
export function exploreNotice(code: string | null | undefined): ExploreNotice | null {
  if (!code) return null;
  if (Object.hasOwn(DONE, code)) return { tone: "success", text: DONE[code] };
  return Object.hasOwn(ERRORS, code) ? { tone: "error", text: ERRORS[code] } : null;
}

/** The form field a refusal is about (its input's name), so the form can mark it; null for none. */
const REFUSAL_FIELDS: Record<string, string> = {
  invalid_slug: "slug", slug_taken: "slug", invalid_name: "name", invalid_description: "description", invalid_visibility: "visibility",
  invalid_kind: "kind", invalid_title: "title",
  invalid_metric: "metric", invalid_sport: "sport", invalid_target: "target", invalid_window: "day", community_not_found: "community",
  // The reversible moderation actions' reason and note, and Add moderator's username.
  invalid_reason: "reason", reason_required: "reason", invalid_note: "note",
  unknown_username: "username", not_member: "username", not_adult: "username",
};
export function refusalField(code: string): string | null {
  return Object.hasOwn(REFUSAL_FIELDS, code) ? REFUSAL_FIELDS[code] : null;
}

export const NOTICE_KEYS = { done: Object.keys(DONE), errors: Object.keys(ERRORS) } as const;
