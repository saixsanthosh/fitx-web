/**
 * The answer of /api/social/video-links (wave-2 brief 3.9), over injected calls so it is tested without a database.
 * The member's own session asks fitx_social_video_link_allowed which of the paths they may play (visibility, the
 * explore_video switch, 40 plays a day per member and the project's daily play bytes, each play recorded); only those
 * are then signed with the server key, for VIDEO_LINK_SECONDS.
 */
import { toSocialError } from "@/lib/social/errors";
import { VIDEO_LINK_SECONDS, VIDEO_PATH } from "@/lib/social/video/links";

export const MAX_PATHS = 10;

export type VideoLinkDeps = {
  /** fitx_social_video_link_allowed as the member: the playable paths, or it throws the database error. */
  allowed(paths: string[]): Promise<string[]>;
  /** Signed links for `paths`, with the server key. */
  sign(paths: string[], seconds: number): Promise<Record<string, string>>;
};

export type Answer = { status: number; body: Record<string, unknown> };

/** 1 to 10 distinct video paths of the shape <uid>/<uuid>/<n>.mp4, or null. */
export function parsePaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PATHS) return null;
  const paths = [...new Set(value)];
  if (!paths.every((path): path is string => typeof path === "string" && VIDEO_PATH.test(path))) return null;
  return paths;
}

export async function answerVideoLinks(body: Record<string, unknown>, deps: VideoLinkDeps): Promise<Answer> {
  const paths = parsePaths(body.paths);
  if (!paths) return { status: 400, body: { error: "social_invalid" } };
  let allowed: string[];
  try {
    allowed = (await deps.allowed(paths)).filter((path) => paths.includes(path));
  } catch (error) {
    const social = toSocialError(error);
    switch (social.key) {
      case "social_unavailable":
      case "unavailable":
        return { status: 503, body: { error: "social_unavailable" } };
      case "social_link_budget":
        return { status: 429, body: { error: "social_link_budget", hint: social.hint } };
      case "rate_limited":
        return { status: 429, body: { error: "rate_limited", hint: social.hint } };
      case "social_signed_out":
        return { status: 401, body: { error: "social_signed_out" } };
      case "social_no_profile":
      case "social_suspended":
      case "social_invalid":
        return { status: social.key === "social_invalid" ? 400 : 403, body: { error: social.key } };
      default:
        return { status: 500, body: { error: "failed" } };
    }
  }
  if (!allowed.length) return { status: 200, body: { links: {}, seconds: VIDEO_LINK_SECONDS } };
  try {
    const links = await deps.sign(allowed, VIDEO_LINK_SECONDS);
    return { status: 200, body: { links, seconds: VIDEO_LINK_SECONDS } };
  } catch {
    return { status: 500, body: { error: "failed" } };
  }
}
