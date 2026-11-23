"use client";

import Link from "next/link";
import { Clapperboard, Heart, Layers, MessageCircle } from "lucide-react";
import { compactCount, postCoverPath, type SocialPost } from "@/lib/social";
import { SocialPhoto } from "./SocialPhoto";
import styles from "./Explore.module.css";

/** Square tiles of posts; each opens the post. */
export function PostGrid({ posts, label }: { posts: SocialPost[]; label: string }) {
  return (
    <ul className={styles.grid} aria-label={label}>
      {posts.map((post) => (
        <li key={post.id}>
          <Link href={`/explore/p/${post.id}`} className={styles.tile} aria-label={tileLabel(post)}>
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
