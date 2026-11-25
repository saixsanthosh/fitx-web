import { SOCIAL_LIMITS } from "./limits";

/** Why a composer's Share cannot go yet: nothing to post, photos still being made smaller, or the post is on its way. */
export type ShareBlock = "no_media" | "preparing" | "posting";

/**
 * A composer's Share rule (bug 61). A post in the feed needs its photos (1 to 10) or its video: the database takes posts
 * without one only in communities (fitx_social_insert_post), so a caption alone cannot be shared here. Null when it can.
 */
export function shareBlock({ media, preparing = 0, posting }: { media: number; preparing?: number; posting: boolean }): ShareBlock | null {
  if (posting) return "posting";
  if (preparing > 0) return "preparing";
  if (media < 1) return "no_media";
  return null;
}

/**
 * The reason shown under a Share button that cannot go yet (its description, so it is heard on focus too). Posting
 * needs none: the button itself says "Posting…".
 */
export function shareBlockText(block: ShareBlock | null, kind: "photo" | "video" = "photo"): string | null {
  if (block === "no_media") return kind === "video" ? "Choose a video to share a post." : "Add at least one photo to share a post.";
  if (block === "preparing") return "One moment: your photos are still being made smaller.";
  return null;
}

/** The photo area's line before any photo is added: how many a post takes, and that one is needed. */
export const PHOTO_AREA_HINT = `A post needs 1 to ${SOCIAL_LIMITS.photosPerPost} photos. They are made smaller on your device first.`;
