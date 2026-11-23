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
};

export class SocialError extends Error {
  key: string;
  constructor(key: string, message: string) {
    super(message);
    this.name = "SocialError";
    this.key = key;
  }
}

/** The key the database raised (social_…), "rate_limited", "unavailable" (not set up yet) or "failed". */
export function socialErrorKey(error: unknown): string {
  const value = error as ErrorLike;
  const code = typeof value?.code === "string" ? value.code : "";
  const message = typeof value?.message === "string" ? value.message : "";
  if (code === "PT429" || /social_rate_limited/.test(message)) return "rate_limited";
  if (code === "PGRST202" || code === "42883" || code === "PGRST205" || code === "42P01") return "unavailable";
  const key = /\b(social_[a-z_]+)\b/.exec(message)?.[1];
  return key ?? "failed";
}

export function socialErrorMessage(error: unknown): string {
  const key = socialErrorKey(error);
  if (key === "rate_limited") {
    const hint = (error as ErrorLike)?.hint;
    return hint === "day" ? "You have reached today’s limit for that. Try again tomorrow." : "That is a lot in one hour. Try again later.";
  }
  if (key === "unavailable") return "Explore needs the next FITX update.";
  return MESSAGES[key] ?? "That did not work. Check your connection and try again.";
}

export function toSocialError(error: unknown): SocialError {
  if (error instanceof SocialError) return error;
  return new SocialError(socialErrorKey(error), socialErrorMessage(error));
}
