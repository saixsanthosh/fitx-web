/**
 * The Explore database functions, typed. Every call runs as the signed-in member with their own key; the database
 * checks who may see or do what (supabase/migrations/20261123100060_fitx_social_v1.sql).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { toSocialError } from "./errors";
import type {
  CommentPolicy, Cursor, FollowListEntry, FollowState, MyProfile, NotificationPrefs, ProfilePage, ReportReason, ReportTarget,
  SearchResult, SocialComment, SocialMe, SocialNotification, SocialPost, Suggestion,
} from "./types";
import type { SocialAuthor } from "./types";

export type Db = Pick<SupabaseClient, "rpc">;

async function call<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw toSocialError(error);
  return data as T;
}

const page = (cursor: Cursor) => ({ p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null });

/** The cursor after a newest-first page, or null when it was the last one. */
export function nextCursor(items: readonly { created_at: string; id: string }[], limit: number): Cursor {
  if (items.length < limit) return null;
  const last = items[items.length - 1];
  return { at: last.created_at, id: last.id };
}

export const socialApi = {
  me: (db: Db) => call<SocialMe>(db, "fitx_social_me"),
  usernameAvailable: (db: Db, username: string) => call<boolean>(db, "fitx_social_username_available", { p_username: username }),
  saveProfile: (db: Db, input: { username: string; displayName: string; bio: string; isPrivate: boolean; commentPolicy: CommentPolicy }) =>
    call<MyProfile>(db, "fitx_social_save_profile", {
      p_username: input.username, p_display_name: input.displayName, p_bio: input.bio, p_is_private: input.isPrivate,
      p_default_comment_policy: input.commentPolicy,
    }),
  /** Returns the previous picture's path (to delete), or null. */
  setAvatar: (db: Db, path: string | null) => call<string | null>(db, "fitx_social_set_avatar", { p_path: path }),
  profile: (db: Db, username: string) => call<ProfilePage | null>(db, "fitx_social_profile", { p_username: username }),

  follow: (db: Db, userId: string) => call<FollowState>(db, "fitx_social_follow", { p_target: userId }),
  unfollow: (db: Db, userId: string) => call<void>(db, "fitx_social_unfollow", { p_target: userId }),
  answerRequest: (db: Db, userId: string, accept: boolean) => call<void>(db, "fitx_social_answer_request", { p_follower: userId, p_accept: accept }),
  removeFollower: (db: Db, userId: string) => call<void>(db, "fitx_social_remove_follower", { p_follower: userId }),
  setBlock: (db: Db, userId: string, block: boolean) => call<void>(db, "fitx_social_set_block", { p_target: userId, p_block: block }),
  setRestrict: (db: Db, userId: string, restrict: boolean) => call<void>(db, "fitx_social_set_restrict", { p_target: userId, p_restrict: restrict }),
  report: (db: Db, target: ReportTarget, id: string, reason: ReportReason, details: string | null) =>
    call<string>(db, "fitx_social_report", { p_target_type: target, p_target_id: id, p_reason: reason, p_details: details }),

  createPost: (db: Db, input: { id: string; caption: string; location: string; topics: string[]; commentPolicy: CommentPolicy;
    media: { path: string; width: number; height: number; alt: string }[] }) =>
    call<SocialPost>(db, "fitx_social_create_post", {
      p_post_id: input.id, p_caption: input.caption, p_location: input.location, p_topics: input.topics,
      p_comment_policy: input.commentPolicy, p_media: input.media,
    }),
  updatePost: (db: Db, id: string, input: { caption: string; location: string; topics: string[]; commentPolicy: CommentPolicy }) =>
    call<SocialPost>(db, "fitx_social_update_post", {
      p_post: id, p_caption: input.caption, p_location: input.location, p_topics: input.topics, p_comment_policy: input.commentPolicy,
    }),
  /** Returns the post's photo paths, which the caller deletes from the bucket. */
  deletePost: (db: Db, id: string) => call<string[]>(db, "fitx_social_delete_post", { p_post: id }),
  setLike: (db: Db, id: string, like: boolean) => call<{ liked: boolean; like_count: number }>(db, "fitx_social_set_like", { p_post: id, p_like: like }),
  setSave: (db: Db, id: string, save: boolean) => call<boolean>(db, "fitx_social_set_save", { p_post: id, p_save: save }),
  addComment: (db: Db, postId: string, parentId: string | null, body: string) =>
    call<SocialComment>(db, "fitx_social_add_comment", { p_post: postId, p_parent: parentId, p_body: body }),
  editComment: (db: Db, id: string, body: string) => call<SocialComment>(db, "fitx_social_edit_comment", { p_comment: id, p_body: body }),
  deleteComment: (db: Db, id: string) => call<void>(db, "fitx_social_delete_comment", { p_comment: id }),

  feed: (db: Db, cursor: Cursor, limit = 8) => call<SocialPost[]>(db, "fitx_social_feed", { ...page(cursor), p_limit: limit }),
  browse: (db: Db, filter: { userId?: string; tag?: string; topic?: string }, cursor: Cursor, limit = 18) =>
    call<SocialPost[]>(db, "fitx_social_browse", {
      p_user: filter.userId ?? null, p_tag: filter.tag ?? null, p_topic: filter.topic ?? null, ...page(cursor), p_limit: limit,
    }),
  trending: (db: Db, topic: string | null, days = 7, limit = 12, offset = 0) =>
    call<SocialPost[]>(db, "fitx_social_trending", { p_topic: topic, p_days: days, p_limit: limit, p_offset: offset }),
  suggestions: (db: Db, limit = 8) => call<Suggestion[]>(db, "fitx_social_suggestions", { p_limit: limit }),
  search: (db: Db, query: string) => call<SearchResult>(db, "fitx_social_search", { p_query: query, p_limit: 10 }),
  post: (db: Db, id: string) => call<SocialPost | null>(db, "fitx_social_post", { p_post: id }),
  saved: (db: Db, before: string | null, limit = 18) => call<SocialPost[]>(db, "fitx_social_saved", { p_before_at: before, p_limit: limit }),
  comments: (db: Db, postId: string, after: Cursor) =>
    call<SocialComment[]>(db, "fitx_social_comments", { p_post: postId, p_after_at: after?.at ?? null, p_after_id: after?.id ?? null, p_limit: 30 }),
  followList: (db: Db, userId: string, kind: "followers" | "following", offset = 0) =>
    call<FollowListEntry[]>(db, "fitx_social_follow_list", { p_user: userId, p_kind: kind, p_offset: offset, p_limit: 30 }),
  requests: (db: Db) => call<{ user: SocialAuthor; created_at: string }[]>(db, "fitx_social_requests"),
  notifications: (db: Db, cursor: Cursor, limit = 30) => call<SocialNotification[]>(db, "fitx_social_notifications", { ...page(cursor), p_limit: limit }),
  markRead: (db: Db) => call<number>(db, "fitx_social_mark_read"),
  notificationPrefs: (db: Db) => call<NotificationPrefs>(db, "fitx_social_notification_prefs"),
  saveNotificationPrefs: (db: Db, prefs: NotificationPrefs) =>
    call<NotificationPrefs>(db, "fitx_social_save_notification_prefs", {
      p_follows: prefs.follows, p_follow_requests: prefs.follow_requests, p_likes: prefs.likes, p_comments: prefs.comments,
      p_mentions: prefs.mentions,
    }),
  safetyLists: (db: Db) => call<{ blocked: SocialAuthor[]; restricted: SocialAuthor[] }>(db, "fitx_social_safety_lists"),
};
