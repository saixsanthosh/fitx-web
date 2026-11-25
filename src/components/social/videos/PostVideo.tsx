"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { toSocialError } from "@/lib/social";
import type { PostVideoProps } from "@/lib/social/slots";
import { videoLink } from "@/lib/social/video/links";
import { clock } from "@/lib/social/video/plan";
import { createClient } from "@/lib/supabase/client";
import { useExplore } from "../ExploreContext";
import { usePhotoUrl } from "../usePhotoUrl";
import styles from "./Videos.module.css";

/** Only one video plays at a time on a page: starting one pauses the one before. */
let playingNow: HTMLVideoElement | null = null;

function claim(video: HTMLVideoElement) {
  if (playingNow && playingNow !== video) playingNow.pause();
  playingNow = video;
}

/**
 * POST_VIDEO (wave-2 brief 3.10): a video post's player inside PostCard. The poster shows first; the video's signed
 * link is fetched only when the member taps play (so scrolling past costs no play budget), `preload="none"`, muted
 * until they turn the sound on, paused once the card leaves the screen, and only one plays at a time.
 */
export function PostVideo(props: PostVideoProps) {
  return <VideoPlayer {...props} />;
}

export function VideoPlayer({ postId, media, inView, tall = false, label }: PostVideoProps & { tall?: boolean; label?: string }) {
  const { session } = useExplore();
  const poster = usePhotoUrl(media.posterPath);
  const video = useRef<HTMLVideoElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [muted, setMuted] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const ownerId = media.path.split("/")[0] ?? "";
  const ratio = media.width > 0 && media.height > 0 ? media.width / media.height : 9 / 16;
  const shape = tall ? Math.min(1.91, Math.max(9 / 16, ratio)) : Math.min(1.91, Math.max(0.8, ratio));
  const name = label ?? "video";

  useEffect(() => {
    if (!inView && video.current && !video.current.paused) video.current.pause();
  }, [inView]);

  useEffect(() => {
    const element = video.current;
    return () => { if (element && playingNow === element) playingNow = null; };
  }, []);

  async function start() {
    setNote(null);
    const element = video.current;
    if (!element) return;
    if (src) {
      claim(element);
      void element.play().catch(() => setState("paused"));
      return;
    }
    if (!session) return;
    setState("loading");
    try {
      const url = await videoLink(media.path, { ownerId, viewerId: session.userId, db: createClient() });
      if (!url) {
        setNote("This video is not available.");
        setState("idle");
        return;
      }
      setSrc(url);
      element.src = url;
      claim(element);
      await element.play();
    } catch (error) {
      if ((error as Error)?.name === "NotAllowedError") {
        setState("paused");
        return;
      }
      setNote(toSocialError(error).message);
      setState("idle");
    }
  }

  function toggle() {
    const element = video.current;
    // Still loading: the press does nothing (the button stays focusable, aria-disabled, rather than dropping focus).
    if (state === "loading") return;
    if (state === "playing" && element) element.pause();
    else void start();
  }

  const length = media.durationMs > 0 ? clock(media.durationMs) : null;
  return (
    <div className={`${styles.player} ${state === "playing" ? styles.playing : ""}`} style={{ aspectRatio: String(shape) }} data-post-video={postId}>
      {poster === undefined && <span className={styles.wash} aria-hidden="true" />}
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private poster
        <img src={poster} alt="" className={styles.playerMedia} decoding="async" loading="lazy" draggable={false} />
      )}
      <video
        ref={video}
        className={`${styles.playerVideo} ${src && state !== "idle" ? styles.playerVideoOn : ""}`}
        playsInline
        muted={muted}
        preload="none"
        poster={poster ?? undefined}
        aria-label={`${name}, ${length ?? "short video"}`}
        onPlay={() => setState("playing")}
        onPause={() => setState((value) => (value === "loading" ? value : "paused"))}
        onEnded={() => setState("paused")}
        onWaiting={() => setState((value) => (value === "playing" ? value : "loading"))}
        onTimeUpdate={(event) => {
          const element = event.currentTarget;
          if (fill.current && element.duration > 0) fill.current.style.transform = `scaleX(${Math.min(1, element.currentTime / element.duration)})`;
        }}
        onError={() => { if (src) { setNote("This video could not play."); setState("idle"); } }}
      />
      <button type="button" className={styles.playButton} aria-label={state === "playing" ? "Pause video" : "Play video"} onClick={toggle} aria-disabled={state === "loading" || undefined}>
        <span className={styles.playMark} aria-hidden="true">
          {state === "loading" ? <Clapperboard size={24} /> : state === "playing" ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
        </span>
      </button>
      {length && state === "idle" && <span className={styles.lengthBadge} aria-hidden="true"><Clapperboard size={14} />{length}</span>}
      {src && (
        <div className={styles.playerTools}>
          <button type="button" className={styles.toolButton} aria-label="Sound" aria-pressed={!muted} onClick={() => setMuted((value) => !value)}>
            {muted ? <VolumeX size={19} aria-hidden="true" /> : <Volume2 size={19} aria-hidden="true" />}
          </button>
        </div>
      )}
      {src && <div className={styles.timeline} aria-hidden="true"><div ref={fill} className={styles.timelineFill} /></div>}
      {note && <p className={styles.playerNote} role="status">{note}</p>}
    </div>
  );
}
