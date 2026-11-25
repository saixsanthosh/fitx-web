import type { SocialPost } from "./types";

/**
 * Why the member cannot comment on a post, in words, or null when they can. The post carries its own comment setting
 * (comment_policy), so a followers-only post says so and says what would let the reader join in, instead of
 * "Comments are off." (bug 59). It is shown where the comment box would be, so it also explains the missing box and
 * Reply buttons on a post that already has comments.
 */
export function commentGate(post: Pick<SocialPost, "can_comment" | "comment_policy" | "mine"> & { author: Pick<SocialPost["author"], "username"> }): string | null {
  if (post.can_comment) return null;
  if (post.comment_policy === "followers") return `Only @${post.author.username}’s followers can comment. Follow them to join in.`;
  if (post.comment_policy === "off") return post.mine ? "Comments are off. Edit the post to turn them on." : "Comments are off.";
  return "You cannot comment on this post.";
}
