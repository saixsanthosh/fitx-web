/**
 * The shapes the Explore database functions return (supabase/migrations/20261123100060_fitx_social_v1.sql).
 * Everything here is what the signed-in member may see; the database decides that, never the app.
 */

export type CommentPolicy = "everyone" | "followers" | "off";
export type FollowState = "none" | "pending" | "accepted";

export type SocialAuthor = {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  is_private: boolean;
};

export type SocialMedia = { path: string; width: number; height: number; kind: "image"; alt: string | null };

export type SocialPost = {
  id: string;
  kind: "photo";
  caption: string;
  location: string | null;
  topics: string[];
  comment_policy: CommentPolicy;
  created_at: string;
  edited_at: string | null;
  author: SocialAuthor;
  media: SocialMedia[];
  like_count: number;
  comment_count: number;
  liked: boolean;
  saved: boolean;
  mine: boolean;
  can_comment: boolean;
  /** Trending only: likes + 2 × commenters + 3 × saves from other members in the window. */
  score?: number;
  /** Saved list only. */
  saved_at?: string;
};

export type SocialComment = {
  id: string;
  post_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  author: SocialAuthor;
  mine: boolean;
  can_delete: boolean;
  /** Shown to the post's owner only: the author is restricted, so nobody else sees this comment. */
  restricted: boolean;
  replies?: SocialComment[];
};

export type MyProfile = SocialAuthor & { bio: string; default_comment_policy: CommentPolicy };

export type SocialMe = { profile: MyProfile | null; unread: number; requests: number };

export type ProfilePage = {
  profile: SocialAuthor & { bio: string };
  counts: { posts: number; followers: number; following: number };
  relation: { is_self: boolean; following: FollowState; follows_you: boolean; blocked: boolean; restricted: boolean };
  can_see_posts: boolean;
};

export type NotificationType = "follow" | "follow_request" | "follow_accepted" | "like" | "comment" | "reply" | "mention";

export type SocialNotification = {
  id: string;
  type: NotificationType;
  created_at: string;
  read: boolean;
  actor: SocialAuthor;
  post_id: string | null;
  comment_id: string | null;
  thumb: string | null;
  snippet: string | null;
  following: FollowState;
};

export type Suggestion = {
  user: SocialAuthor;
  reason: "followed_by" | "topic" | "popular" | "new";
  mutual_count: number;
  mutual_username: string | null;
  topic: string | null;
  posts: number;
};

export type SearchResult = { accounts: SocialAuthor[]; hashtags: { tag: string; posts: number }[] };

export type FollowListEntry = { user: SocialAuthor; following: FollowState };

export type NotificationPrefs = { follows: boolean; follow_requests: boolean; likes: boolean; comments: boolean; mentions: boolean };

export type ReportReason = "spam" | "harassment" | "hate" | "nudity" | "violence" | "self_harm" | "false_information" | "scam" | "other";
export type ReportTarget = "post" | "comment" | "account";

/** A cursor for newest-first pages: the last item's time and id. */
export type Cursor = { at: string; id: string } | null;
