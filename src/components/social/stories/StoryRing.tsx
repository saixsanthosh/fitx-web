"use client";

import type { CSSProperties } from "react";
import type { AvatarRingProps } from "@/lib/social/slots";
import { ringFor } from "@/lib/social/stories";
import { createClient } from "@/lib/supabase/client";
import { useStoryTray } from "./trayStore";
import styles from "./Stories.module.css";

/**
 * AVATAR_RING (wave-2 brief 3.6): a ring around a member's picture while they have a live story the viewer may see,
 * warm while unseen and quiet once seen. Drawing only: the avatar sits inside links (a post's author, a search row), so
 * the ring never adds a control of its own; stories open from the tray. Every ring on a page shares one tray read.
 */
export function StoryRing({ userId, size, children }: AvatarRingProps) {
  const tray = useStoryTray(createClient());
  const ring = ringFor(tray.entries, userId);
  if (!ring) return <>{children}</>;
  const width = size >= 56 ? 3 : 2.5;
  const style = { "--ring-width": `${width}px`, "--ring-gap": `${width + 1.5}px` } as CSSProperties;
  return (
    <span className={`${styles.ring} ${ring === "seen" ? styles.ringSeen : ""}`} style={style} aria-hidden="true" data-story-ring={ring}>
      <span className={styles.ringInner}>{children}</span>
    </span>
  );
}
