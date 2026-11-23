/**
 * Explore's navigation and its create menu (wave-2 brief 3.6, "UI slots"). Pure data: the shell renders only the
 * entries that are `ready`, so a part that has not shipped never shows as a dead link. The integrator flips `ready`
 * (and fills RAIL_BADGES) when the stream that builds a part has merged (brief 6.1a); the filling streams never do.
 */
import type { ComponentType } from "react";
import { MessagesBadge } from "./realtime";

export type RailKey = "feed" | "discover" | "videos" | "community" | "messages";

export type RailEntry = {
  key: RailKey; label: string; href: string; ready: boolean;
  /** Also needs Admin's explore_video switch (fitx_social_me().videos): while videos are off the tab is not shown. */
  needsVideo?: boolean;
};

export const EXPLORE_RAIL: readonly RailEntry[] = [
  { key: "feed", label: "Feed", href: "/explore", ready: true },
  { key: "discover", label: "Discover", href: "/explore/discover", ready: true },
  { key: "videos", label: "Videos", href: "/explore/videos", ready: true, needsVideo: true },
  { key: "community", label: "Community", href: "/explore/community", ready: true },
  { key: "messages", label: "Messages", href: "/explore/messages", ready: true },
];

/**
 * A badge drawn on a rail link (for example the unread messages count). Each one names itself for screen readers
 * ("<n> unread messages") and renders nothing when its count is unknown or zero.
 */
export const RAIL_BADGES: Partial<Record<RailKey, ComponentType>> = { messages: MessagesBadge };

/**
 * A rail link's accessible name. The link's own name wins over its badge's, so the count goes into it: "Messages, 3
 * unread". Unknown or zero gives the label alone (never "0 unread").
 */
export function railLinkName(key: string, label: string, unreadMessages: number | null): string {
  return key === "messages" && unreadMessages ? `${label}, ${unreadMessages} unread` : label;
}

export type CreateKey = "photo" | "story" | "video";

export type CreateOption = {
  key: CreateKey;
  label: string;
  /** One short line under the label in the create menu. */
  hint: string;
  href: string;
  ready: boolean;
  /** Also needs Admin's explore_video switch (fitx_social_me().videos). */
  needsVideo?: boolean;
};

export const CREATE_OPTIONS: readonly CreateOption[] = [
  { key: "photo", label: "Photo post", hint: "Up to 10 photos", href: "/explore/new", ready: true },
  { key: "story", label: "Story", hint: "Gone after 24 hours", href: "/explore/stories/new", ready: true },
  { key: "video", label: "Video", hint: "Up to 30 seconds", href: "/explore/videos/new", ready: true, needsVideo: true },
];

/** The rail entries to show: the ready ones, in order, and video ones only while videos are switched on. */
export function railEntries(rail: readonly RailEntry[] = EXPLORE_RAIL, videosOn = false): RailEntry[] {
  return rail.filter((entry) => entry.ready && (!entry.needsVideo || videosOn));
}

/** The create choices a member has now: ready ones, and video ones only while videos are switched on. */
export function createChoices(videosOn: boolean, options: readonly CreateOption[] = CREATE_OPTIONS): CreateOption[] {
  return options.filter((option) => option.ready && (!option.needsVideo || videosOn));
}

/** Which rail entry a path belongs to (the longest matching href), or null for Notifications, a profile or settings. */
export function railKeyFor(pathname: string, rail: readonly RailEntry[] = EXPLORE_RAIL): RailKey | null {
  let best: RailEntry | null = null;
  for (const entry of rail) {
    const match = entry.href === "/explore" ? pathname === "/explore" : pathname === entry.href || pathname.startsWith(`${entry.href}/`);
    if (match && (!best || entry.href.length > best.href.length)) best = entry;
  }
  return best?.key ?? null;
}
