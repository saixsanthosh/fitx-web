/**
 * The short-video feed ("Videos", P14.4) and Discover's "Fitness videos" (P14.3), built from the reads the database
 * already has: the member's feed (their own and followed accounts' posts) and Discover's latest (listed posts of public
 * accounts), keeping only video posts. Each read already applies every visibility rule, so nothing here decides who
 * sees what. Pages are pulled until enough videos are found or both sources run out, with a cap on reads per call.
 */
import type { Cursor, SocialPost } from "../types";

export type PostPage = (cursor: Cursor, limit: number) => Promise<SocialPost[]>;

export const VIDEO_FEED = { readLimit: 30, readsPerCall: 4 } as const;

const isVideo = (post: SocialPost) => post.kind === "video" && post.media[0]?.kind === "video";

/** Newest first, ties by id, as the database orders them. */
export function newestFirst(a: SocialPost, b: SocialPost): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

type Source = { read: PostPage; cursor: Cursor; done: boolean };

/**
 * A pager over several post sources. `next(want)` returns up to `want` video posts not returned before, newest first,
 * and whether every source has run out.
 */
export function createVideoPager(reads: readonly PostPage[], { readLimit = VIDEO_FEED.readLimit as number, readsPerCall = VIDEO_FEED.readsPerCall as number }: { readLimit?: number; readsPerCall?: number } = {}) {
  const sources: Source[] = reads.map((read) => ({ read, cursor: null, done: false }));
  const seen = new Set<string>();
  const buffer: SocialPost[] = [];

  async function readOnce(): Promise<void> {
    await Promise.all(sources.filter((source) => !source.done).map(async (source) => {
      const items = await source.read(source.cursor, readLimit);
      if (items.length < readLimit) source.done = true;
      const last = items[items.length - 1];
      if (last) source.cursor = { at: last.created_at, id: last.id };
      for (const post of items) {
        if (!isVideo(post) || seen.has(post.id)) continue;
        seen.add(post.id);
        buffer.push(post);
      }
    }));
    buffer.sort(newestFirst);
  }

  return {
    async next(want: number): Promise<{ items: SocialPost[]; done: boolean }> {
      let calls = 0;
      while (buffer.length < want && sources.some((source) => !source.done) && calls < readsPerCall) {
        await readOnce();
        calls += 1;
      }
      const items = buffer.splice(0, want);
      return { items, done: !buffer.length && sources.every((source) => source.done) };
    },
    /** Marks a post as already shown (for example one opened by link first). */
    skip(id: string) {
      seen.add(id);
    },
  };
}
