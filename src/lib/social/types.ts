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

export type SocialMedia = {
  path: string;
  width: number;
  height: number;
  kind: "image" | "video";
  alt: string | null;
  /** Video only (wave 2): the poster at <uid>/<post id>/<n>p.webp, and the length. */
  poster_path?: string | null;
  duration_ms?: number | null;
};

/** Set by FITX moderators (wave 2). Only the owner of a limited or hidden item is told. */
export type ModerationState = "visible" | "limited" | "hidden";

export type SocialPost = {
  id: string;
  /** "video" posts have one video item; "text" posts (community discussions) have none. */
  kind: "photo" | "video" | "text";
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
  /** Wave 2: set for the owner only, when FITX limited or hid the post. Absent from a wave-1 database. */
  moderation?: Exclude<ModerationState, "visible"> | null;
  community_id?: string | null;
  challenge_id?: string | null;
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

export type DmPolicy = "everyone" | "followers" | "mutuals" | "off";
export type MyProfile = SocialAuthor & {
  bio: string;
  default_comment_policy: CommentPolicy;
  /** Wave 2 (absent before 20261124100000 is applied). */
  dm_policy?: DmPolicy;
  birth_date_added_at?: string | null;
};

/** adult 18+, teen 13 to 17, child under 13 (no Explore profile), unknown (no date of birth: teen rules). */
export type AgeBand = "adult" | "teen" | "child" | "unknown";

export type SocialMe = {
  profile: MyProfile | null;
  unread: number;
  requests: number;
  /** Wave 2 keys; undefined before 20261124100000 is applied. */
  explore?: boolean;
  videos?: boolean;
  age_band?: AgeBand;
  /** An active Explore suspension; until null means until FITX lifts it. */
  suspension?: { until: string | null; since: string } | null;
  /** Every active sanction kind: "explore", "dm", "upload". */
  sanctions?: string[];
};

export type ProfilePage = {
  profile: SocialAuthor & { bio: string };
  counts: { posts: number; followers: number; following: number };
  relation: { is_self: boolean; following: FollowState; follows_you: boolean; blocked: boolean; restricted: boolean };
  can_see_posts: boolean;
};

export type NotificationType =
  | "follow" | "follow_request" | "follow_accepted" | "like" | "comment" | "reply" | "mention"
  // Wave 2
  | "story_like" | "story_reply" | "challenge_invite" | "challenge_badge" | "community_request" | "community_invite"
  | "community_accepted" | "message_request" | "message" | "report_reviewed";

export type SocialNotification = {
  id: string;
  type: NotificationType;
  created_at: string;
  read: boolean;
  /** Null for notices from FITX (a reviewed report, a badge) and for message requests, which name nobody. */
  actor: SocialAuthor | null;
  post_id: string | null;
  comment_id: string | null;
  thumb: string | null;
  snippet: string | null;
  following: FollowState;
  // Wave 2 (absent before 20261124100000 is applied).
  story_id?: string | null;
  community_id?: string | null;
  challenge_id?: string | null;
  conversation_id?: string | null;
  entity_type?: string;
  entity_id?: string;
  community?: { slug: string; name: string } | null;
  challenge?: { title: string } | null;
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

export type NotificationPrefs = {
  follows: boolean;
  follow_requests: boolean;
  likes: boolean;
  comments: boolean;
  mentions: boolean;
  /** Wave 2; undefined before 20261124100000 is applied. */
  stories?: boolean;
  challenges?: boolean;
  communities?: boolean;
  messages?: boolean;
};

export type ReportReason = "spam" | "harassment" | "hate" | "nudity" | "violence" | "self_harm" | "false_information" | "scam" | "other";
export type ReportTarget = "post" | "comment" | "account" | "story" | "message" | "community" | "challenge";

/** "Your Explore content" (fitx_social_my_content). */
export type MyContent = {
  posts: { id: string; kind: SocialPost["kind"]; caption: string; created_at: string; community_id: string | null;
    moderation: Exclude<ModerationState, "visible"> | null; thumb: string | null; media_count: number }[];
  stories: { id: string; kind: "image" | "video"; path: string; poster_path: string | null; caption: string; created_at: string;
    expires_at: string; live: boolean; moderation: Exclude<ModerationState, "visible"> | null }[];
  counts: { posts: number; videos: number; stories: number; comments: number };
};

/** A story as fitx_social_stories returns it. Counts and moderation are the owner's only. */
export type SocialStory = {
  id: string;
  user_id: string;
  kind: "image" | "video";
  path: string;
  poster_path: string | null;
  width: number;
  height: number;
  duration_ms: number | null;
  caption: string;
  created_at: string;
  expires_at: string;
  mine: boolean;
  seen: boolean;
  liked: boolean;
  view_count: number | null;
  like_count: number | null;
  moderation: Exclude<ModerationState, "visible"> | null;
};

export type StoryTrayEntry = { user: SocialAuthor; count: number; latest_at: string; unseen: boolean; mine: boolean };

/** A cursor for newest-first pages: the last item's time and id. */
export type Cursor = { at: string; id: string } | null;
