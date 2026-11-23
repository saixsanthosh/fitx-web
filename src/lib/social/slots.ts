/**
 * The component slots social-core renders for the parts later streams build (wave-2 brief 3.6). The integrator points
 * each slot at the filling stream's component (brief 6.1a, release 2a); a host still treats a null slot as "today's UI
 * or nothing", so a slot can be emptied again without touching the host. Props are fixed here, and every filling
 * component imports only these prop types (`import type`), so the slot table and the components never form a value cycle
 * beyond the render-time reads of the hosts.
 */
import type { ComponentType, ReactNode } from "react";
import { MessageButton } from "@/components/social/messages/MessageButton";
import { SendTo } from "@/components/social/messages/SendTo";
import { StoryReply } from "@/components/social/messages/StoryReply";
import { StoryRing } from "@/components/social/stories/StoryRing";
import { StoryTray } from "@/components/social/stories/StoryTray";
import { DiscoverVideos } from "@/components/social/videos/DiscoverVideos";
import { PostVideo } from "@/components/social/videos/PostVideo";

/** The feed, above the first post (social-stories: StoryTray). */
export type FeedTopProps = Record<string, never>;
export const FEED_TOP_SLOT: ComponentType<FeedTopProps> | null = StoryTray;

/** A video post's player in PostCard (feed, profile grid, the post page). While null, PostCard shows the poster. */
export type PostVideoProps = {
  postId: string;
  media: { path: string; posterPath: string; width: number; height: number; durationMs: number };
  /** True while the card is mostly on screen: only that card plays. */
  inView: boolean;
};
export const POST_VIDEO: ComponentType<PostVideoProps> | null = PostVideo;

/** Discover's "Fitness videos" section (social-stories). */
export type DiscoverVideosProps = { limit: number };
export const DISCOVER_VIDEOS: ComponentType<DiscoverVideosProps> | null = DiscoverVideos;

/** Around every avatar in the feed, profiles and comments (social-stories: the story ring). */
export type AvatarRingProps = { userId: string; size: number; children: ReactNode };
export const AVATAR_RING: ComponentType<AvatarRingProps> | null = StoryRing;

/** The post share menu, as "Send to…" (social-groups). */
export type ShareTargetsProps = { postId: string; onDone: () => void };
export const SHARE_TARGETS: ComponentType<ShareTargetsProps> | null = SendTo;

/** The profile header, after Follow (social-groups: the "Message" button). */
export type ProfileActionsProps = { userId: string; username: string };
export const PROFILE_ACTIONS: ComponentType<ProfileActionsProps> | null = MessageButton;

/** social-stories' story viewer renders this under a story (social-groups: a reply sent as a message). */
export type StoryReplyProps = { storyId: string; ownerId: string; onSent: () => void };
export const STORY_REPLY: ComponentType<StoryReplyProps> | null = StoryReply;
