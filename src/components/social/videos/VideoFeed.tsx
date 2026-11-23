"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, CirclePause, Clapperboard, Heart, Loader2, MessageCircle, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Reveal } from "@/components/motion/Reveal";
import { PageHeader } from "@/components/ui/PageHeader";
import { fullDate, plural, relativeTime, socialApi, toSocialError, type SocialPost } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import { isUuid } from "@/lib/social/paths";
import { createVideoPager } from "@/lib/social/video/feed";
import { clock } from "@/lib/social/video/plan";
import { Avatar } from "../Avatar";
import { useReadyExplore } from "../ExploreContext";
import { RichText } from "../RichText";
import { sharePost } from "../share";
import { usePaged, useSentinel } from "../usePaged";
import { usePhotoUrl } from "../usePhotoUrl";
import exploreStyles from "../Explore.module.css";
import { VideoPlayer } from "./PostVideo";
import styles from "./Videos.module.css";

const PAGE = 4;

/**
 * The Videos tab (P14.4, "a short-form fitness video section"): video posts from the member's feed and from public
 * accounts, newest first, one tall card each, playing only on tap. With `?v=<post id>` that video comes first. While FITX
 * has videos paused (explore_video off) the cards show their posters with "Videos are paused by FITX" and no play or
 * create control.
 */
export function VideoFeed() {
  const { db, userId, me } = useReadyExplore();
  const videosOn = me.videos === true;
  const params = useSearchParams();
  const first = params.get("v");
  const firstId = first && isUuid(first) ? first : null;
  const pager = useRef<ReturnType<typeof createVideoPager> | null>(null);
  const feed = usePaged<SocialPost, number>(`videos:${userId}:${firstId ?? ""}`, async (cursor) => {
    if (cursor === null || !pager.current) {
      pager.current = createVideoPager([
        (page, limit) => socialApi.feed(db, page, limit),
        (page, limit) => socialApi.browse(db, {}, page, limit),
      ]);
    }
    const lead: SocialPost[] = [];
    if (cursor === null && firstId) {
      const post = await socialApi.post(db, firstId).catch(() => null);
      if (post?.kind === "video") lead.push(post);
      pager.current.skip(firstId);
    }
    const page = await pager.current.next(PAGE);
    return { items: [...lead, ...page.items], next: page.done ? null : (cursor ?? 0) + 1 };
  });
  const sentinel = useSentinel(feed.more, !feed.done && feed.status === "ready");

  return (
    <>
      <PageHeader title="Videos" className="sr-only" />
      <div className={styles.feed}>
        <div className={styles.column}>
          {!videosOn && (
            <p className={styles.banner} role="status">
              <CirclePause size={18} aria-hidden="true" />
              <span><span className={styles.bannerTitle}>Videos are paused by FITX</span>FITX is checking videos on phones first. Photo posts and stories work as usual.</span>
            </p>
          )}
          {videosOn && (
            <div className="flex items-center justify-between gap-3">
              <h2 className={exploreStyles.sectionTitle}>Short videos</h2>
              <Link href="/explore/videos/new" className={`${exploreStyles.smallButton} ${exploreStyles.smallButtonQuiet}`}><Plus size={17} aria-hidden="true" />New video</Link>
            </div>
          )}
          {feed.status === "loading" && (
            <>
              <div className={exploreStyles.skeleton} style={{ aspectRatio: "9 / 14" }} aria-hidden="true" />
              <p className="sr-only" role="status">Loading videos</p>
            </>
          )}
          {feed.status === "error" && !feed.items.length && (
            <div className={exploreStyles.empty} role="alert">
              <p className={exploreStyles.emptyText}>{feed.error}</p>
              <button type="button" className="fitx-button fitx-button-secondary" onClick={feed.reload}>Try again</button>
            </div>
          )}
          {feed.status !== "loading" && feed.status !== "error" && !feed.items.length && (
            <div className={exploreStyles.empty}>
              <span className={exploreStyles.emptyMark}><Clapperboard size={26} aria-hidden="true" /></span>
              <h2 className={exploreStyles.emptyTitle}>No videos yet</h2>
              <p className={exploreStyles.emptyText}>Short videos from people you follow and from public accounts show here.</p>
              {videosOn && <Link href="/explore/videos/new" className="fitx-button"><Plus size={17} aria-hidden="true" />New video</Link>}
            </div>
          )}
          {feed.items.map((post, index) => (
            <Reveal key={post.id} y={14} amount={0.08}>
              <VideoCard db={db} post={post} playable={videosOn} priority={index < 1} onChange={feed.replace} />
            </Reveal>
          ))}
          {feed.items.length > 0 && !feed.done && (
            <div className="flex justify-center">
              <button type="button" className={`${exploreStyles.smallButton} ${exploreStyles.smallButtonQuiet}`} onClick={feed.more} disabled={feed.status === "more"}>
                {feed.status === "more" ? <><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading</> : "Show more"}
              </button>
            </div>
          )}
          {feed.items.length > 0 && feed.done && <p className={`${exploreStyles.note} text-center`}>That is every video for now.</p>}
          <div ref={sentinel} className={exploreStyles.sentinel} aria-hidden="true" />
        </div>
        <aside className={styles.aside} aria-label="About videos">
          <p className={styles.asideText}>Videos play when you tap them, with the sound off until you turn it on. Only one plays at a time.</p>
        </aside>
      </div>
    </>
  );
}

/** True while at least `threshold` of the element is on screen. */
function useInView<T extends Element>(threshold = 0.6) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold });
    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/** One video in the Videos tab: the player (or, while paused by FITX, its poster), then like, comment, share and save. */
function VideoCard({ db, post, playable, priority, onChange }: { db: Db; post: SocialPost; playable: boolean; priority: boolean; onChange: (post: SocialPost) => void }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const busy = useRef(false);
  const item = post.media[0];
  const author = post.author;

  const setLike = useCallback(async (like: boolean) => {
    if (busy.current) return;
    busy.current = true;
    onChange({ ...post, liked: like, like_count: Math.max(0, post.like_count + (like ? 1 : -1)) });
    try {
      const result = await socialApi.setLike(db, post.id, like);
      onChange({ ...post, liked: result.liked, like_count: result.like_count });
    } catch (error) {
      onChange(post);
      toast.error(toSocialError(error).message);
    } finally {
      busy.current = false;
    }
  }, [db, onChange, post]);

  async function toggleSave() {
    onChange({ ...post, saved: !post.saved });
    try {
      const saved = await socialApi.setSave(db, post.id, !post.saved);
      onChange({ ...post, saved });
      toast.success(saved ? "Saved to your profile" : "Removed from saved");
    } catch (error) {
      onChange(post);
      toast.error(toSocialError(error).message);
    }
  }

  async function share() {
    const result = await sharePost(post.id, author.username);
    if (result === "copied") toast.success("Link copied");
    else if (result === "failed") toast.error("The link could not be copied.");
  }

  if (!item) return null;
  const media = { path: item.path, posterPath: item.poster_path ?? "", width: item.width, height: item.height, durationMs: item.duration_ms ?? 0 };
  return (
    <article className={styles.card} aria-labelledby={`video-${post.id}-by`}>
      <header className={styles.cardHead}>
        <Link href={`/explore/u/${author.username}`} className={exploreStyles.who}>
          <Avatar user={author} size={40} />
          <span className={exploreStyles.whoText}>
            <span id={`video-${post.id}-by`} className={exploreStyles.whoName}>{author.display_name}</span>
            <span className={exploreStyles.whoMeta}>@{author.username}{post.location ? ` · ${post.location}` : ""}</span>
          </span>
        </Link>
      </header>
      <div ref={ref}>
        {playable && item.poster_path ? (
          <VideoPlayer postId={post.id} media={media} inView={inView} tall label={`Video by ${author.display_name}`} />
        ) : (
          <PausedPoster path={item.poster_path ?? null} width={item.width} height={item.height} durationMs={item.duration_ms ?? null} priority={priority} />
        )}
      </div>
      <div className={styles.actions}>
        <button type="button" className={`${exploreStyles.iconButton} ${post.liked ? exploreStyles.likeOn : ""}`} aria-pressed={post.liked} aria-label="Like" onClick={() => void setLike(!post.liked)}>
          <Heart size={23} aria-hidden="true" fill={post.liked ? "currentColor" : "none"} />
        </button>
        <Link href={`/explore/p/${post.id}#comments`} className={exploreStyles.iconButton} aria-label="Comment"><MessageCircle size={22} aria-hidden="true" /></Link>
        <button type="button" className={exploreStyles.iconButton} aria-label="Share" onClick={() => void share()}><Send size={21} aria-hidden="true" /></button>
        <span className={exploreStyles.actionsGap} />
        <button type="button" className={exploreStyles.iconButton} aria-pressed={post.saved} aria-label="Save" onClick={() => void toggleSave()}>
          <Bookmark size={22} aria-hidden="true" fill={post.saved ? "currentColor" : "none"} />
        </button>
      </div>
      <div className={styles.cardBody}>
        <p className={exploreStyles.stats} aria-live="polite">{plural(post.like_count, "like")}</p>
        {post.caption && (
          <p className={`${exploreStyles.caption} ${exploreStyles.captionClamp}`}>
            <Link href={`/explore/u/${author.username}`} className={exploreStyles.captionName}>{author.username}</Link>
            <RichText text={post.caption} />
          </p>
        )}
        {post.comment_count > 0 && (
          <Link href={`/explore/p/${post.id}#comments`} className={exploreStyles.linkQuiet}>
            {post.comment_count === 1 ? "View 1 comment" : `View all ${plural(post.comment_count, "comment")}`}
          </Link>
        )}
        <p className={exploreStyles.time}><time dateTime={post.created_at} title={fullDate(post.created_at)}>{relativeTime(post.created_at)}</time></p>
      </div>
    </article>
  );
}

function PausedPoster({ path, width, height, durationMs, priority }: { path: string | null; width: number; height: number; durationMs: number | null; priority: boolean }) {
  const url = usePhotoUrl(path);
  const ratio = width > 0 && height > 0 ? Math.min(1.91, Math.max(9 / 16, width / height)) : 9 / 16;
  return (
    <div className={styles.player} style={{ aspectRatio: String(ratio) }}>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private poster
        <img src={url} alt="" className={styles.playerMedia} decoding="async" loading={priority ? "eager" : "lazy"} />
      )}
      {durationMs ? <span className={styles.lengthBadge} aria-hidden="true"><Clapperboard size={14} />{clock(durationMs)}</span> : null}
      <p className={styles.playerNote} style={{ bottom: 12 }}>Videos are paused by FITX</p>
    </div>
  );
}
