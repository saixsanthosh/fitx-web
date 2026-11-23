"use client";

import Link from "next/link";
import { Heart, Layers, MessageCircle } from "lucide-react";
import { compactCount, type SocialPost } from "@/lib/social";
import { SocialPhoto } from "./SocialPhoto";
import styles from "./Explore.module.css";

/** Square tiles of posts; each opens the post. */
export function PostGrid({ posts, label }: { posts: SocialPost[]; label: string }) {
  return (
    <ul className={styles.grid} aria-label={label}>
      {posts.map((post) => (
        <li key={post.id}>
          <Link href={`/explore/p/${post.id}`} className={styles.tile} aria-label={tileLabel(post)}>
            {post.media[0] && <SocialPhoto path={post.media[0].path} alt="" ratio={1} />}
            {post.media.length > 1 && <Layers size={18} className={styles.tileMany} aria-hidden="true" />}
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

export function tileLabel(post: SocialPost): string {
  const caption = post.caption.trim().split("\n")[0].slice(0, 80);
  const photos = post.media.length > 1 ? `, ${post.media.length} photos` : "";
  return `Post by @${post.author.username}${photos}${caption ? `: ${caption}` : ""}`;
}
