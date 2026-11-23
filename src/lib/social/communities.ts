/**
 * Communities, typed (supabase/migrations/20261124100010_fitx_social_v2_groups.sql). FITX creates them in Admin (O3 a);
 * adult members join, post and discuss. The database decides who sees what.
 */
import { toSocialError } from "./errors";
import type { Db } from "./api";
import type { Cursor, SocialAuthor, SocialPost } from "./types";

export type CommunityStatus = "none" | "pending" | "accepted";
export type CommunityRole = "owner" | "moderator" | "member";

export type Community = {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  /** Set only while the member may see the cover (public, or a member of a private one). */
  cover_path: string | null;
  member_count: number;
  my_status: CommunityStatus;
  my_role: CommunityRole | null;
};

export type CommunityChallenge = {
  id: string; kind: "weekly" | "monthly"; title: string; metric: string; sport: string | null; target: number | null;
  starts_at: string; ends_at: string; joined: boolean;
};

export type CommunityPage = {
  community: Community & { created_at: string };
  can_see_posts: boolean;
  can_post: boolean;
  is_moderator: boolean;
  moderators: SocialAuthor[];
  /** Moderators only. */
  requests: { user: SocialAuthor; requested_at: string }[];
  challenges: CommunityChallenge[];
};

async function call<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw toSocialError(error);
  return data as T;
}

export type GroupMedia = { path: string; width: number; height: number; alt: string; kind?: "image" | "video"; poster_path?: string; duration_ms?: number };

export const communitiesApi = {
  list: (db: Db, query: string | null = null) => call<Community[]>(db, "fitx_social_communities", { p_query: query }),
  get: (db: Db, slug: string) => call<CommunityPage | null>(db, "fitx_social_community", { p_slug: slug }),
  posts: (db: Db, communityId: string, cursor: Cursor) =>
    call<SocialPost[]>(db, "fitx_social_community_posts", { p_community: communityId, p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null }),
  join: (db: Db, communityId: string) => call<{ status: CommunityStatus; role: CommunityRole | null }>(db, "fitx_social_join_community", { p_community: communityId }),
  leave: (db: Db, communityId: string) => call<boolean>(db, "fitx_social_leave_community", { p_community: communityId }),
  answer: (db: Db, communityId: string, userId: string, accept: boolean) =>
    call<{ status: CommunityStatus }>(db, "fitx_social_answer_community_request", { p_community: communityId, p_user: userId, p_accept: accept }),
  /** A post or discussion in a community, or a progress share in a challenge: exactly one of the two ids. */
  createGroupPost: (db: Db, input: { id: string; caption: string; topics: string[]; media: GroupMedia[] | null; communityId?: string | null; challengeId?: string | null }) =>
    call<SocialPost & { entry?: { value: number } }>(db, "fitx_social_create_group_post", {
      p_post_id: input.id, p_caption: input.caption, p_topics: input.topics, p_media: input.media && input.media.length ? input.media : null,
      p_community_id: input.communityId ?? null, p_challenge_id: input.challengeId ?? null,
    }),
  moderatorRemove: (db: Db, postId: string, reason: string) => call<boolean>(db, "fitx_social_moderator_remove_post", { p_post: postId, p_reason_code: reason }),
};

/** "1 member", "1,204 members". */
export function memberCountText(count: number): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? "member" : "members"}`;
}

/** The main button on a community, by the member's place in it. */
export function joinLabel(community: Pick<Community, "visibility" | "my_status">): { label: string; action: "join" | "leave" | "withdraw" } {
  if (community.my_status === "accepted") return { label: "Leave", action: "leave" };
  if (community.my_status === "pending") return { label: "Withdraw request", action: "withdraw" };
  return community.visibility === "private" ? { label: "Ask to join", action: "join" } : { label: "Join", action: "join" };
}

/** Moderator removal reasons (the same words as reports, so Admin reads one list). */
export const REMOVE_REASONS: readonly { value: string; label: string }[] = [
  { value: "spam", label: "Spam or selling" },
  { value: "harassment", label: "Bullying or harassment" },
  { value: "off_topic", label: "Off topic for this community" },
  { value: "other", label: "Something else" },
];
