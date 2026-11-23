/**
 * Stories (wave-2 brief 3.6 "Stories", 3.9 routes): the pure parts the tray, ring, composer and viewer share. A story
 * is one photo or one video (at most 15 s) and lives 24 hours; the database checks expiry on every read, so an ended
 * story never shows even if the clean-up has not run yet.
 */
import { extensionFor, type PhotoType } from "./paths";
import type { SocialStory, StoryTrayEntry } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A photo story is on screen this long; a video story for its own length. */
export const STORY_PHOTO_MS = 5_000;

/** <uid>/<story id>/0.(webp|jpg|mp4): the one file of a story, as create_story expects it. */
export function storyFilePath(userId: string, storyId: string, kind: "image" | "video", type?: PhotoType): string {
  if (!UUID.test(userId) || !UUID.test(storyId)) throw new Error("Invalid story path");
  if (kind === "video") return `${userId}/${storyId}/0.mp4`;
  if (!type) throw new Error("Invalid story path");
  return `${userId}/${storyId}/0.${extensionFor(type)}`;
}

/** How long a story stays on screen before the viewer moves on. */
export function storyPlayMs(story: Pick<SocialStory, "kind" | "duration_ms">): number {
  if (story.kind === "video" && story.duration_ms && story.duration_ms > 0) return Math.min(15_000, story.duration_ms);
  return STORY_PHOTO_MS;
}

export type StoryCursor = { user: number; story: number };

/**
 * The next (dir 1) or previous (dir -1) story across every account in the viewer: `counts[i]` is how many stories
 * account i has. Returns null when moving forward past the last story (the viewer closes). Moving back from the very
 * first story stays on it.
 */
export function stepStory(counts: readonly number[], at: StoryCursor, dir: 1 | -1): StoryCursor | null {
  if (!counts.length) return null;
  if (dir === 1) {
    if (at.story + 1 < (counts[at.user] ?? 0)) return { user: at.user, story: at.story + 1 };
    for (let user = at.user + 1; user < counts.length; user += 1) if (counts[user] > 0) return { user, story: 0 };
    return null;
  }
  if (at.story > 0) return { user: at.user, story: at.story - 1 };
  for (let user = at.user - 1; user >= 0; user -= 1) if (counts[user] > 0) return { user, story: counts[user] - 1 };
  return { user: at.user, story: 0 };
}

/** Where to start in one account's stories: the first the member has not seen, else the first. */
export function firstUnseen(stories: readonly Pick<SocialStory, "seen">[]): number {
  const index = stories.findIndex((story) => !story.seen);
  return index < 0 ? 0 : index;
}

/** The ring around an account's picture: "unseen" (a live story the member has not seen), "seen", or null (none). */
export function ringFor(tray: readonly StoryTrayEntry[] | null, userId: string): "unseen" | "seen" | null {
  const entry = tray?.find((item) => item.user.id === userId);
  if (!entry || entry.count < 1) return null;
  return entry.unseen ? "unseen" : "seen";
}

/** The tray after the member has seen every story of `userId` (unseen first, then the rest, order otherwise kept). */
export function markTraySeen(tray: readonly StoryTrayEntry[], userId: string): StoryTrayEntry[] {
  return tray.map((entry) => (entry.user.id === userId ? { ...entry, unseen: false } : entry));
}

/** The accounts the viewer walks through when opened on `username`: that account, then the tray's others in order. */
export function viewerOrder(tray: readonly StoryTrayEntry[] | null, username: string): string[] {
  const names = (tray ?? []).filter((entry) => entry.count > 0).map((entry) => entry.user.username);
  const at = names.indexOf(username);
  if (at < 0) return [username];
  return [username, ...names.slice(at + 1)];
}

/**
 * True when a key event comes from a field (an input, a text area, a select or editable content): the story viewer then
 * leaves the arrow keys to it, so moving the caret in the reply box never changes the story.
 */
export function isTextEntry(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT";
}

/** For the owner: how long the story has left ("23 h left", "40 min left", "Ending now"). */
export function timeLeft(expiresAt: string, now: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 60_000) return "Ending now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h left`;
}

/** "Seen by 3" for the owner; null when the count is unknown (never shown as 0 then). */
export function seenByLabel(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  return `Seen by ${count.toLocaleString("en-GB")}`;
}
