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
} as const;

export const SOCIAL_BUCKET = "social-media";
