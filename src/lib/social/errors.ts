/** What the member reads when an Explore request fails. The database raises message keys (social_…). */
type ErrorLike = { code?: unknown; message?: unknown; hint?: unknown } | null | undefined;

const MESSAGES: Record<string, string> = {
  social_signed_out: "Sign in again to use Explore.",
  social_no_profile: "Set up your Explore profile first.",
  social_not_found: "That is no longer available.",
  social_username_invalid: "That username cannot be used.",
  social_username_reserved: "That name is kept for FITX.",
  social_username_taken: "That username is taken.",
  social_name_invalid: "Add a name of up to 50 characters.",
  social_bio_too_long: "Keep your bio to 300 characters.",
  social_caption_too_long: "Keep the caption to 2,200 characters.",
  social_comment_invalid: "Comments are 1 to 1,000 characters.",
  social_comments_closed: "Comments are turned off for you on this post.",
  social_media_missing: "A photo did not upload. Try again.",
  social_media_count: "Add 1 to 10 photos.",
  social_invalid: "Something in that was not valid.",
  // Wave 2 (20261124100000 and the groups and Admin migrations after it).
  social_suspended: "Your Explore account is paused by FITX. You can still delete your content and change your settings.",
  social_unavailable: "Explore is paused by FITX for now. You can still manage or delete your content in Explore settings.",
  social_age_restricted: "That part of Explore is for members aged 18 and over.",
  // The message pages say more, from what the sender knows (messageErrorText in messages.ts, bug 19).
  social_dm_not_allowed: "This member is not taking messages from you.",
  social_video_cap: "Video posts are full for now. Try a photo instead.",
  social_storage_full: "Explore is out of space for new uploads right now. Try again later.",
  social_story_expired: "That story has ended.",
  social_link_budget: "Videos have reached today’s viewing limit. They play again tomorrow.",
  social_not_member: "Join this community first.",
  social_challenge_closed: "This challenge has ended.",
  social_birth_date_set: "Your date of birth is already saved. To change it, ask FITX support.",
};

/** The error keys that mean Explore itself is closed to the member right now (not a problem with one request). */
export const SOCIAL_CLOSED_KEYS = ["social_suspended", "social_unavailable"] as const;

export class SocialError extends Error {
  key: string;
  /** The database's hint: "hour" or "day" for limits, the age band for social_age_restricted, and the like. */
  hint: string | null;
  constructor(key: string, message: string, hint: string | null = null) {
    super(message);
    this.name = "SocialError";
    this.key = key;
    this.hint = hint;
  }
}

/** The key the database raised (social_…), "rate_limited", "unavailable" (not set up yet) or "failed". */
export function socialErrorKey(error: unknown): string {
  const value = error as ErrorLike;
  const code = typeof value?.code === "string" ? value.code : "";
  const message = typeof value?.message === "string" ? value.message : "";
  const key = /\b(social_[a-z_]+)\b/.exec(message)?.[1];
  // social_link_budget is raised with PT429 too, so a named key wins over the code.
  if (key === "social_rate_limited" || (!key && code === "PT429")) return "rate_limited";
  if (code === "PGRST202" || code === "42883" || code === "PGRST205" || code === "42P01") return "unavailable";
  return key ?? "failed";
}

export function socialErrorMessage(error: unknown): string {
  const key = socialErrorKey(error);
  if (key === "rate_limited") {
    const hint = (error as ErrorLike)?.hint;
    return hint === "day" ? "You have reached today’s limit for that. Try again tomorrow." : "That is a lot in one hour. Try again later.";
  }
  if (key === "unavailable") return "Explore needs the next FITX update.";
  if (key === "social_age_restricted") {
    const hint = (error as ErrorLike)?.hint;
    if (hint === "unknown") return "Add your date of birth in Explore settings to use this. It is for members aged 18 and over.";
  }
  return MESSAGES[key] ?? "That did not work. Check your connection and try again.";
}

export function toSocialError(error: unknown): SocialError {
  if (error instanceof SocialError) return error;
  const hint = (error as ErrorLike)?.hint;
  return new SocialError(socialErrorKey(error), socialErrorMessage(error), typeof hint === "string" && hint ? hint : null);
}
