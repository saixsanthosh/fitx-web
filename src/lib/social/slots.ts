/**
 * The component slots social-core renders for the parts later streams build (wave-2 brief 3.6). Each slot is null
 * until the integrator points it at the filling stream's component (brief 6.1a); while null, the host renders today's
 * UI or nothing. Props are fixed here, so a filling stream builds against them in its own folder.
 */
import type { ComponentType, ReactNode } from "react";

/** The feed, above the first post (social-stories: StoryTray). */
export type FeedTopProps = Record<string, never>;
export const FEED_TOP_SLOT: ComponentType<FeedTopProps> | null = null;

/** A video post's player in PostCard (feed, profile grid, the post page). While null, PostCard shows the poster. */
export type PostVideoProps = {
  postId: string;
  media: { path: string; posterPath: string; width: number; height: number; durationMs: number };
  /** True while the card is mostly on screen: only that card plays. */
  inView: boolean;
};
export const POST_VIDEO: ComponentType<PostVideoProps> | null = null;

/** Discover's "Fitness videos" section (social-stories). */
export type DiscoverVideosProps = { limit: number };
export const DISCOVER_VIDEOS: ComponentType<DiscoverVideosProps> | null = null;

/** Around every avatar in the feed, profiles and comments (social-stories: the story ring). */
export type AvatarRingProps = { userId: string; size: number; children: ReactNode };
export const AVATAR_RING: ComponentType<AvatarRingProps> | null = null;

/** The post share menu, as "Send to…" (social-groups). */
export type ShareTargetsProps = { postId: string; onDone: () => void };
export const SHARE_TARGETS: ComponentType<ShareTargetsProps> | null = null;

/** The profile header, after Follow (social-groups: the "Message" button). */
export type ProfileActionsProps = { userId: string; username: string };
export const PROFILE_ACTIONS: ComponentType<ProfileActionsProps> | null = null;

/** social-stories' story viewer renders this under a story (social-groups: a reply sent as a message). */
export type StoryReplyProps = { storyId: string; ownerId: string; onSent: () => void };
export const STORY_REPLY: ComponentType<StoryReplyProps> | null = null;
