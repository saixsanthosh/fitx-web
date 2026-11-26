"use client";

import Link from "next/link";
import type { Ref } from "react";
import { Clapperboard, Heart, Layers, MessageCircle } from "lucide-react";
import { compactCount, postCoverPath, type SocialPost } from "@/lib/social";
import { SocialPhoto } from "./SocialPhoto";
import styles from "./Explore.module.css";

/** Square tiles of posts; each opens the post. `ref` reaches the list, for gridTile and lastTile. */
export function PostGrid({ posts, label, ref }: { posts: SocialPost[]; label: string; ref?: Ref<HTMLUListElement> }) {
  return (
    <ul ref={ref} className={styles.grid} aria-label={label}>
      {posts.map((post) => (
        <li key={post.id}>
          <Link href={`/explore/p/${post.id}`} className={styles.tile} aria-label={tileLabel(post)} data-post-id={post.id}>
            <TileCover post={post} />
            {post.media.length > 1 && <Layers size={18} className={styles.tileMany} aria-hidden="true" />}
            {post.kind === "video" && <Clapperboard size={18} className={styles.tileMany} aria-hidden="true" />}
            <span className={styles.tileStats} aria-hidden="true">
              <span className="inline-flex items-center gap-1"><Heart size={16} fill="currentColor" />{compactCount(post.like_count)}</span>
              <span className="inline-flex items-center gap-1"><MessageCircle size={16} fill="currentColor" />{compactCount(post.comment_count)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A post's tile in a grid (where a newly loaded post takes focus, D5). */
export function gridTile(grid: HTMLElement | null, postId: string): HTMLElement | null {
  return grid?.querySelector<HTMLElement>(`a[data-post-id="${postId}"]`) ?? null;
}

/** A grid's last tile. */
export function lastTile(grid: HTMLElement | null): HTMLElement | null {
  return grid?.querySelector<HTMLElement>("li:last-child > a") ?? null;
}

/** A tile's picture: the first photo or a video's poster; a text post shows its first words. */
export function TileCover({ post, priority = false }: { post: SocialPost; priority?: boolean }) {
  const cover = postCoverPath(post);
  if (cover) return <SocialPhoto path={cover} alt="" ratio={1} priority={priority} />;
  if (post.kind === "text") return <span className={styles.tileText} aria-hidden="true">{post.caption.slice(0, 120)}</span>;
  return null;
}

export function tileLabel(post: SocialPost): string {
  const caption = post.caption.trim().split("\n")[0].slice(0, 80);
  const photos = post.kind === "video" ? ", video" : post.media.length > 1 ? `, ${post.media.length} photos` : "";
  return `Post by @${post.author.username}${photos}${caption ? `: ${caption}` : ""}`;
}
