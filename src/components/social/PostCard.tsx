"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Bookmark, ChevronLeft, ChevronRight, Clapperboard, EyeOff, Flag, Heart, Link2, MessageCircle, MoreHorizontal, Pencil, Send, ShieldAlert, Trash2, UserX } from "lucide-react";
import { toast } from "sonner";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
import { Sheet } from "@/components/ui/Sheet";
import { SOCIAL_BUCKET, fullDate, plural, relativeTime, socialApi, toSocialError, topicLabel, type SocialPost } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import { forgetPhotoUrls } from "@/lib/social/media-urls";
import { POST_VIDEO, SHARE_TARGETS } from "@/lib/social/slots";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./Avatar";
import { useExplore } from "./ExploreContext";
import { EditPostSheet } from "./EditPostSheet";
import { ReportSheet } from "./ReportSheet";
import { RichText } from "./RichText";
import { frameRatio, SocialPhoto } from "./SocialPhoto";
import { postUrl, sharePost } from "./share";
import styles from "./Explore.module.css";

type Props = {
  db: Db;
  post: SocialPost;
  /** The first posts on a page load their photos at once. */
  priority?: boolean;
  /** On the post's own page the caption is shown in full and the comment link is left out. */
  detail?: boolean;
  onChange?: (post: SocialPost) => void;
  /** The post was deleted, or its author blocked: take it off the list. */
  onRemove?: (id: string) => void;
};

/** A post in the feed or on its own page. */
export function PostCard({ db, post, priority = false, detail = false, onChange, onRemove }: Props) {
  const reduced = useReducedMotionSafe();
  const [state, setState] = useState(post);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "block" | null>(null);
  const [report, setReport] = useState(false);
  const [expanded, setExpanded] = useState(detail);
  const [burst, setBurst] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const pending = useRef(false);
  const videosOn = useExplore().me?.videos === true;

  const [shown, setShown] = useState(post);
  if (shown !== post) {
    setShown(post);
    setState(post);
  }
  const update = useCallback((next: SocialPost) => {
    setState(next);
    onChange?.(next);
  }, [onChange]);

  const author = state.author;
  const ratio = frameRatio(state.media[0]?.width ?? 4, state.media[0]?.height ?? 5);
  const captionLong = state.caption.length > 180 || state.caption.split("\n").length > 3;

  async function setLike(like: boolean) {
    if (pending.current) return;
    pending.current = true;
    const before = state;
    update({ ...state, liked: like, like_count: Math.max(0, state.like_count + (like ? 1 : -1)) });
    try {
      const result = await socialApi.setLike(db, state.id, like);
      update({ ...before, liked: result.liked, like_count: result.like_count });
    } catch (error) {
      update(before);
      toast.error(toSocialError(error).message);
    } finally {
      pending.current = false;
    }
  }

  async function toggleSave() {
    const before = state;
    update({ ...state, saved: !state.saved });
    try {
      const saved = await socialApi.setSave(db, state.id, !before.saved);
      update({ ...before, saved });
      toast.success(saved ? "Saved to your profile" : "Removed from saved");
    } catch (error) {
      update(before);
      toast.error(toSocialError(error).message);
    }
  }

  function likeFromPhoto() {
    if (!reduced) setBurst((value) => value + 1);
    if (!state.liked) void setLike(true);
  }

  async function share() {
    if (SHARE_TARGETS) {
      setSharing(true);
      return;
    }
    await shareLink();
  }

  async function shareLink() {
    setSharing(false);
    const result = await sharePost(state.id, author.username);
    if (result === "copied") toast.success("Link copied");
    else if (result === "failed") toast.error("The link could not be copied.");
  }

  async function copyLink() {
    setMenu(false);
    try {
      await navigator.clipboard.writeText(postUrl(state.id));
      toast.success("Link copied");
    } catch {
      toast.error("The link could not be copied.");
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const paths = await socialApi.deletePost(db, state.id);
      const storage = createClient()?.storage;
      if (storage && paths.length) await storage.from(SOCIAL_BUCKET).remove(paths);
      forgetPhotoUrls(paths);
      toast.success("Post deleted");
      setConfirm(null);
      onRemove?.(state.id);
    } catch (error) {
      toast.error(toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    setBusy(true);
    try {
      await socialApi.setBlock(db, author.id, true);
      toast.success(`@${author.username} is blocked`);
      setConfirm(null);
      onRemove?.(state.id);
    } catch (error) {
      toast.error(toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={styles.card} aria-labelledby={`post-${state.id}-by`}>
      <header className={styles.cardHead}>
        <Link href={`/explore/u/${author.username}`} className={styles.who}>
          <Avatar user={author} size={40} />
          <span className={styles.whoText}>
            <span id={`post-${state.id}-by`} className={styles.whoName}>{author.display_name}</span>
            <span className={styles.whoMeta}>@{author.username}{state.location ? ` · ${state.location}` : ""}</span>
          </span>
        </Link>
        <button type="button" className={styles.iconButton} aria-label="Post options" aria-haspopup="dialog" onClick={() => setMenu(true)}>
          <MoreHorizontal size={20} aria-hidden="true" />
        </button>
      </header>

      {state.moderation && <ModerationNote state={state.moderation} />}
      {state.kind === "video" ? (
        <VideoMedia post={state} paused={!videosOn} priority={priority} />
      ) : state.kind === "text" ? (
        <p className={styles.textPost}><RichText text={state.caption} /></p>
      ) : (
        <Carousel post={state} ratio={ratio} priority={priority} onDoubleTap={likeFromPhoto} burst={burst} />
      )}

      <div className={styles.actions}>
        <m.button
          type="button"
          className={`${styles.iconButton} ${state.liked ? styles.likeOn : ""}`}
          aria-pressed={state.liked}
          aria-label="Like"
          onClick={() => void setLike(!state.liked)}
          whileTap={reduced ? undefined : { scale: 0.82 }}
        >
          <m.span key={state.liked ? "on" : "off"} initial={reduced || !state.liked ? false : { scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 16 }} className="inline-flex">
            <Heart size={23} aria-hidden="true" fill={state.liked ? "currentColor" : "none"} />
          </m.span>
        </m.button>
        {detail ? (
          <a href="#comments" className={styles.iconButton} aria-label="Comment"><MessageCircle size={22} aria-hidden="true" /></a>
        ) : (
          <Link href={`/explore/p/${state.id}#comments`} className={styles.iconButton} aria-label="Comment"><MessageCircle size={22} aria-hidden="true" /></Link>
        )}
        <button type="button" className={styles.iconButton} aria-label="Share" onClick={() => void share()}><Send size={21} aria-hidden="true" /></button>
        <span className={styles.actionsGap} />
        <button type="button" className={styles.iconButton} aria-pressed={state.saved} aria-label="Save" onClick={() => void toggleSave()}>
          <Bookmark size={22} aria-hidden="true" fill={state.saved ? "currentColor" : "none"} />
        </button>
      </div>

      <div className={styles.body}>
        <p className={styles.stats} aria-live="polite">{plural(state.like_count, "like")}</p>
        {state.caption && state.kind !== "text" && (
          <>
            <p className={`${styles.caption} ${!expanded && captionLong ? styles.captionClamp : ""}`}>
              <Link href={`/explore/u/${author.username}`} className={styles.captionName}>{author.username}</Link>
              <RichText text={state.caption} />
            </p>
            {!expanded && captionLong && <button type="button" className={styles.more} onClick={() => setExpanded(true)}>More</button>}
          </>
        )}
        {state.topics.length > 0 && (
          <div className={styles.topicRow}>
            {state.topics.map((topic) => <Link key={topic} href={`/explore/discover?topic=${topic}`} className={styles.topicPill}>{topicLabel(topic)}</Link>)}
          </div>
        )}
        {!detail && state.comment_count > 0 && (
          <Link href={`/explore/p/${state.id}#comments`} className={styles.linkQuiet}>
            {state.comment_count === 1 ? "View 1 comment" : `View all ${plural(state.comment_count, "comment")}`}
          </Link>
        )}
        <p className={styles.time}>
          <time dateTime={state.created_at} title={fullDate(state.created_at)}>{relativeTime(state.created_at)}</time>
          {state.edited_at && <span> · Edited</span>}
          {!detail && state.comment_policy === "off" && <span> · Comments off</span>}
        </p>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title="Post options">
        <div className={styles.menu}>
          {state.mine && (
            <>
              <button type="button" className={styles.menuItem} onClick={() => { setMenu(false); setEditing(true); }}><Pencil size={18} aria-hidden="true" />Edit post</button>
              <button type="button" className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => { setMenu(false); setConfirm("delete"); }}><Trash2 size={18} aria-hidden="true" />Delete post</button>
            </>
          )}
          <button type="button" className={styles.menuItem} onClick={() => void copyLink()}><Link2 size={18} aria-hidden="true" />Copy link</button>
          {!state.mine && (
            <>
              <button type="button" className={styles.menuItem} onClick={() => { setMenu(false); setReport(true); }}><Flag size={18} aria-hidden="true" />Report post</button>
              <button type="button" className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => { setMenu(false); setConfirm("block"); }}><UserX size={18} aria-hidden="true" />Block @{author.username}</button>
            </>
          )}
        </div>
      </Sheet>

      <Sheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        side="center"
        title={confirm === "delete" ? "Delete this post?" : `Block @${author.username}?`}
        description={confirm === "delete"
          ? "Its photos, likes and comments are deleted too. This cannot be undone."
          : "Neither of you will see the other’s profile, posts or comments, and any follows between you end. They are not told."}
        footer={
          <div className="flex gap-2">
            <button type="button" className="fitx-button fitx-button-secondary flex-1" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="fitx-button fitx-button-danger flex-1" disabled={busy} onClick={() => void (confirm === "delete" ? remove() : block())}>
              {confirm === "delete" ? "Delete" : "Block"}
            </button>
          </div>
        }
      >
        <span />
      </Sheet>

      {SHARE_TARGETS && (
        <Sheet open={sharing} onClose={() => setSharing(false)} title="Share post">
          <div className={styles.menu}>
            <ShareTargets postId={state.id} onDone={() => setSharing(false)} />
            <button type="button" className={styles.menuItem} onClick={() => void shareLink()}><Link2 size={18} aria-hidden="true" />Share link</button>
          </div>
        </Sheet>
      )}

      <EditPostSheet db={db} post={editing ? state : null} onClose={() => setEditing(false)} onSaved={update} />
      <ReportSheet db={db} target={report ? { type: "post", id: state.id } : null} onClose={() => setReport(false)} />
    </article>
  );
}

function ShareTargets(props: { postId: string; onDone: () => void }) {
  const Targets = SHARE_TARGETS;
  return Targets ? <Targets {...props} /> : null;
}

/** Shown to the owner only: what FITX did to the post, in plain words. */
function ModerationNote({ state }: { state: "limited" | "hidden" }) {
  const Icon = state === "hidden" ? EyeOff : ShieldAlert;
  return (
    <p className={styles.modNote} role="note">
      <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>
        <span className={styles.modNoteTitle}>{state === "hidden" ? "Hidden by FITX" : "Limited by FITX"}</span>
        {state === "hidden" ? "Only you can see this post. FITX hid it after a review." : "Only your followers can see this post. It is left out of Discover and search."}
      </span>
    </p>
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

function duration(ms: number | null | undefined): string | null {
  if (!ms || ms < 1) return null;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A video post: social-stories' player (POST_VIDEO) once it ships and videos are on; until then, and while FITX has
 * videos paused, the poster with its length. The video file itself is signed only when played (by the server route).
 */
function VideoMedia({ post, paused, priority }: { post: SocialPost; paused: boolean; priority: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const item = post.media[0];
  const Player = POST_VIDEO;
  if (!item) return null;
  const ratio = frameRatio(item.width, item.height);
  const length = duration(item.duration_ms);
  return (
    <div ref={ref} className={styles.videoFrame}>
      {Player && !paused && item.poster_path ? (
        <Player postId={post.id} inView={inView} media={{ path: item.path, posterPath: item.poster_path, width: item.width, height: item.height, durationMs: item.duration_ms ?? 0 }} />
      ) : (
        <>
          {item.poster_path && <SocialPhoto path={item.poster_path} ratio={ratio} priority={priority} alt={item.alt ?? `Video by ${post.author.display_name}`} />}
          <span className={styles.videoBadge}><Clapperboard size={14} aria-hidden="true" />{length ? `Video, ${length}` : "Video"}</span>
          {paused && <span className={styles.videoPaused}>Videos are paused by FITX</span>}
        </>
      )}
    </div>
  );
}

/** The post's photos: swipe or scroll on phones, arrows and keys elsewhere, double-tap to like. */
function Carousel({ post, ratio, priority, onDoubleTap, burst }: { post: SocialPost; ratio: number; priority: boolean; onDoubleTap: () => void; burst: number }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = post.media.length;
  const lastTap = useRef(0);

  const onScroll = () => {
    const element = track.current;
    if (!element) return;
    setIndex(Math.round(element.scrollLeft / Math.max(1, element.clientWidth)));
  };
  const go = (to: number) => {
    const element = track.current;
    if (!element) return;
    const next = Math.max(0, Math.min(count - 1, to));
    element.scrollTo({ left: next * element.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") return;
    const now = performance.now();
    if (now - lastTap.current < 300) onDoubleTap();
    lastTap.current = now;
  };

  return (
    <div
      className={styles.media}
      role={count > 1 ? "region" : undefined}
      aria-roledescription={count > 1 ? "carousel" : undefined}
      aria-label={count > 1 ? `${count} photos` : undefined}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
      }}
    >
      <div ref={track} className={styles.track} onScroll={onScroll} onDoubleClick={onDoubleTap} onPointerUp={onPointerUp} tabIndex={count > 1 ? 0 : -1}>
        {post.media.map((item, position) => (
          <div key={item.path} className={styles.slide} aria-roledescription={count > 1 ? "slide" : undefined} aria-label={count > 1 ? `${position + 1} of ${count}` : undefined}>
            <SocialPhoto path={item.path} ratio={ratio} priority={priority && position === 0} alt={item.alt ?? `Photo ${position + 1} of ${count} by ${post.author.display_name}`} />
          </div>
        ))}
      </div>
      <AnimatePresence>
        {burst > 0 && (
          <m.span
            key={burst}
            className={styles.burst}
            initial={{ opacity: 0, scale: 0.4, x: "-50%", y: "-50%" }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.15, 1, 1.05], x: "-50%", y: "-50%" }}
            transition={{ duration: 0.8, times: [0, 0.25, 0.6, 1], ease: [0.22, 1, 0.36, 1] }}
            aria-hidden="true"
          >
            <Heart size={88} fill="currentColor" />
          </m.span>
        )}
      </AnimatePresence>
      {count > 1 && (
        <>
          <span className={styles.count} aria-hidden="true">{index + 1}/{count}</span>
          {index > 0 && <button type="button" className={`${styles.slideButton} ${styles.slidePrev}`} aria-label="Previous photo" onClick={() => go(index - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>}
          {index < count - 1 && <button type="button" className={`${styles.slideButton} ${styles.slideNext}`} aria-label="Next photo" onClick={() => go(index + 1)}><ChevronRight size={18} aria-hidden="true" /></button>}
          <span className={styles.dots} aria-hidden="true">
            {post.media.map((item, position) => <span key={item.path} className={`${styles.dot} ${position === index ? styles.dotOn : ""}`} />)}
          </span>
        </>
      )}
    </div>
  );
}
