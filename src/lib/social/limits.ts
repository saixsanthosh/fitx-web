/**
 * Explore's limits. The database enforces each of them (supabase/migrations/20261123100060_fitx_social_v1.sql); the
 * app checks them first only to say so sooner.
 */
export const SOCIAL_LIMITS = {
  photosPerPost: 10,
  captionChars: 2200,
  locationChars: 80,
  commentChars: 1000,
  bioChars: 300,
  displayNameChars: 50,
  altChars: 300,
  reportDetailsChars: 500,
  /** Photos are re-encoded in the browser to this long edge at most (free-plan storage). */
  photoLongEdge: 1600,
  /** The bucket refuses larger files. */
  fileBytes: 3 * 1024 * 1024,
  /** A photo the member picks may be at most this large before compression. */
  sourceBytes: 40 * 1024 * 1024,
  postsPerHour: 10,
  postsPerDay: 25,
  uploadsPerDay: 60,
  // Wave 2 (20261124100000). Owner-tunable caps live in fitx_social_caps(); these are what the app says.
  storyCaptionChars: 200,
  /** A story lives this long. */
  storyHours: 24,
  storyVideoMs: 15_000,
  postVideoMs: 30_000,
  storiesPerDay: 10,
  videoUploadsPerDay: 3,
  videosKept: 20,
  restrictsPerHour: 30,
  minimumAge: 13,
  /** Messages, communities and leaderboards (O1 a). */
  adultAge: 18,
} as const;

export const SOCIAL_BUCKET = "social-media";
