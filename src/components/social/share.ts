"use client";

/** The link to a post (members who can see it open it; anyone else is asked to sign in). */
export function postUrl(postId: string): string {
  return `${window.location.origin}/explore/p/${postId}`;
}

/**
 * Shares a post with the device's share sheet, or copies its link where there is none. Only the link is shared:
 * the photo stays private behind FITX's sign-in and the post's own visibility.
 */
export async function sharePost(postId: string, author: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url = postUrl(postId);
  const data = { title: `A post by @${author} on FITX`, url };
  if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
