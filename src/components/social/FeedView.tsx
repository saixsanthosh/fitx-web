"use client";

import Link from "next/link";
import { Compass, ImagePlus, Loader2 } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { PageHeader } from "@/components/ui/PageHeader";
import { nextCursor, socialApi, type Cursor, type SocialPost } from "@/lib/social";
import { focusAfterRemoval, postAuthorId, postOptionsId } from "@/lib/social/focus";
import { FEED_TOP_SLOT } from "@/lib/social/slots";
import { useReadyExplore } from "./ExploreContext";
import { PostCard } from "./PostCard";
import { Suggestions } from "./Suggestions";
import { useFocusAfterRender } from "./useFocusAfterRender";
import { useShowMoreFocus } from "./useFocusHandOff";
import { usePaged, useSentinel } from "./usePaged";
import styles from "./Explore.module.css";

const PAGE = 8;

/** The feed: the member's own posts and those of accounts they follow, newest first, loading as they scroll. */
export function FeedView() {
  const { db, userId } = useReadyExplore();
  const feed = usePaged<SocialPost, NonNullable<Cursor>>(`feed:${userId}`, async (cursor) => {
    const items = await socialApi.feed(db, cursor, PAGE);
    return { items, next: nextCursor(items, PAGE) };
  });
  const sentinel = useSentinel(feed.more, !feed.done && feed.status === "ready");
  const FeedTop = FEED_TOP_SLOT;
  const focusAfter = useFocusAfterRender();
  // A deleted post (or a blocked author's) leaves the feed with its Post options button: focus the next card's, or the
  // one before, or the empty feed's heading, never the page body (bug 82's rule).
  const removePost = (id: string) => {
    const order = feed.items.map((item) => postOptionsId(item.id));
    feed.remove(id);
    focusAfter(focusAfterRemoval(order, [postOptionsId(id)]), () => document.getElementById("feed-empty"));
  };
  // Show more goes once the last page is in: if it had focus, the first post that page added takes it, else the
  // "You are up to date." line in its place (D5).
  const [showMoreRef] = useShowMoreFocus(feed.items.map((post) => post.id), (id) => document.getElementById(postAuthorId(id)), () => document.getElementById("feed-end"));

  return (
    <>
      <PageHeader title="Feed" className="sr-only" />
      <div className={styles.feedLayout}>
        <div className={styles.feedColumn}>
          {FeedTop && <FeedTop />}
          {feed.status === "loading" && (
            <>
              <div className={styles.skeleton} style={{ aspectRatio: "4 / 5.6" }} aria-hidden="true" />
              <p className="sr-only" role="status">Loading your feed</p>
            </>
          )}
          {feed.status === "error" && !feed.items.length && (
            <div className={styles.empty} role="alert">
              <p className={styles.emptyText}>{feed.error}</p>
              <button type="button" className="fitx-button fitx-button-secondary" onClick={feed.reload}>Try again</button>
            </div>
          )}
          {feed.status !== "loading" && feed.status !== "error" && !feed.items.length && <EmptyFeed />}
          {feed.items.map((post, index) => (
            <Reveal key={post.id} y={14} amount={0.08}>
              <PostCard db={db} post={post} priority={index < 2} onChange={feed.replace} onRemove={removePost} />
            </Reveal>
          ))}
          {feed.items.length > 0 && !feed.done && (
            <div className="flex justify-center">
              <button type="button" ref={showMoreRef} className={`${styles.smallButton} ${styles.smallButtonQuiet}`} onClick={feed.more} aria-disabled={feed.status === "more" || undefined}>
                {feed.status === "more" ? <><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading</> : "Show more"}
              </button>
            </div>
          )}
          {feed.items.length > 0 && feed.done && <p id="feed-end" tabIndex={-1} className={`${styles.note} text-center`}>You are up to date.</p>}
          {feed.status === "error" && feed.items.length > 0 && <p className={styles.alert} role="alert">{feed.error}</p>}
          <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
        </div>
        <aside className={styles.side} aria-label="Suggested accounts">
          <Suggestions db={db} layout="list" />
        </aside>
      </div>
    </>
  );
}

function EmptyFeed() {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMark}><Compass size={26} aria-hidden="true" /></span>
      <h2 id="feed-empty" tabIndex={-1} className={styles.emptyTitle}>Your feed is quiet</h2>
      <p className={styles.emptyText}>Follow people to see their posts here, or share your first one.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/explore/discover" className="fitx-button"><Compass size={17} aria-hidden="true" />Find people</Link>
        <Link href="/explore/new" className="fitx-button fitx-button-secondary"><ImagePlus size={17} aria-hidden="true" />New post</Link>
      </div>
    </div>
  );
}
