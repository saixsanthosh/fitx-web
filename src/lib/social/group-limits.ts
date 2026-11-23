/**
 * Limits of messages, communities and challenges. The database enforces each of them
 * (supabase/migrations/20261124100010_fitx_social_v2_groups.sql and the rate actions of 20261124100000); the app
 * checks them first only to say so sooner.
 */
export const GROUP_LIMITS = {
  messageChars: 2000,
  messagesPerHour: 60,
  messagesPerDay: 500,
  /** New conversations that land in Requests. Explore accounts under 7 days old may start 2 a day. */
  requestsPerHour: 5,
  requestsPerDay: 15,
  newAccountRequestsPerDay: 2,
  communityPostsPerHour: 10,
  communityPostsPerDay: 30,
  conversationsPage: 30,
  messagesPage: 40,
  communityPostsPage: 12,
  /** A community discussion is a text post: the caption limit applies. */
  discussionChars: 2200,
  /** A challenge closes this long after it ends, after a final sync, so late imports still count. */
  closeGraceHours: 2,
  /** "Top 3" badges need at least this many members on the board. */
  top3MinimumBoard: 10,
  /** Unread counts are read again this often outside Explore (and on every return to the tab). */
  unreadPollMs: 120_000,
  /** While Realtime is not connected, an open conversation looks for new messages this often. */
  conversationPollMs: 15_000,
  /** The inbox channel closes after the tab has been hidden this long. */
  channelIdleMs: 60_000,
} as const;

/** Challenge windows and active days are worked out in this zone (O6 a). */
export const CHALLENGE_TIME_ZONE = "Asia/Kolkata";
