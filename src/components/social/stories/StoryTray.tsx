"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { m } from "framer-motion";
import { Plus } from "lucide-react";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
import type { StoryTrayEntry } from "@/lib/social";
import type { FeedTopProps } from "@/lib/social/slots";
import { Avatar } from "../Avatar";
import { useReadyExplore } from "../ExploreContext";
import { markOpenedInApp, useStoryTray } from "./trayStore";
import styles from "./Stories.module.css";

const RING = { "--ring-width": "3px", "--ring-gap": "4px", margin: 0 } as CSSProperties;

/**
 * FEED_TOP_SLOT (wave-2 brief 3.6): the story tray above the feed. "New story" first, then the member's own live
 * stories, then the accounts they follow with a live story, unseen first (the database's order). Only real stories:
 * with none, the strip says where stories will show.
 */
export function StoryTray(props: FeedTopProps) {
  void props;
  const { db, me } = useReadyExplore();
  const tray = useStoryTray(db);
  const reduced = useReducedMotionSafe();
  const entries = tray.entries ?? [];
  const mine = entries.find((entry) => entry.mine);
  const others = entries.filter((entry) => !entry.mine && entry.count > 0);
  const closed = me.explore === false || Boolean(me.suspension);
  if (closed) return null;

  return (
    <section className={styles.tray} aria-label="Stories">
      <ul className={styles.trayList}>
        <li className={styles.trayItem}>
          <Link href="/explore/stories/new" className={styles.trayLink} aria-label="New story">
            <span className={styles.addMark} aria-hidden="true"><Plus size={24} /></span>
            <span className={styles.trayName} aria-hidden="true">New story</span>
          </Link>
        </li>
        {mine && mine.count > 0 && (
          <TrayEntry entry={mine} label="Your story" name="Your story" index={0} reduced={reduced} />
        )}
        {tray.status === "loading" && !tray.entries && [0, 1, 2].map((key) => (
          <li key={key} className={styles.trayItem} aria-hidden="true"><span className={`${styles.trayLink}`}><span className={styles.traySkeleton} /></span></li>
        ))}
        {others.map((entry, index) => (
          <TrayEntry
            key={entry.user.id}
            entry={entry}
            name={entry.user.username}
            label={`Story by ${entry.user.username}${entry.unseen ? ", new" : ""}`}
            index={index + 1}
            reduced={reduced}
          />
        ))}
      </ul>
      {tray.status === "ready" && !others.length && !mine && (
        <p className={styles.trayEmpty}>Stories from people you follow show here for 24 hours.</p>
      )}
      {tray.status === "error" && <p className={styles.trayEmpty} role="status">Stories did not load. They try again when you come back.</p>}
    </section>
  );
}

function TrayEntry({ entry, label, name, index, reduced }: { entry: StoryTrayEntry; label: string; name: string; index: number; reduced: boolean }) {
  return (
    <m.li
      className={`${styles.trayItem} ${entry.unseen ? styles.trayUnseen : ""}`}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, delay: reduced ? 0 : Math.min(index, 8) * 0.035, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link href={`/explore/stories/${entry.user.username}`} className={styles.trayLink} aria-label={label} onClick={markOpenedInApp}>
        <span className={`${styles.ring} ${entry.unseen ? "" : styles.ringSeen}`} style={RING} aria-hidden="true">
          <span className={styles.ringInner}><Avatar user={{ display_name: entry.user.display_name, avatar_path: entry.user.avatar_path }} size={60} /></span>
        </span>
        <span className={styles.trayName} aria-hidden="true">{name}</span>
      </Link>
    </m.li>
  );
}
