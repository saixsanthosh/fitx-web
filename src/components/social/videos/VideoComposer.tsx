"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CirclePause } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { posterPath, SOCIAL_BUCKET, SOCIAL_LIMITS, socialApi, toSocialError, type CommentPolicy } from "@/lib/social";
import { createClient } from "@/lib/supabase/client";
import { COMMENT_POLICY_OPTIONS } from "../EditPostSheet";
import { useReadyExplore } from "../ExploreContext";
import { TopicPicker } from "../TopicPicker";
import exploreStyles from "../Explore.module.css";
import { uploadVideo } from "./upload";
import { VideoPicker, type PreparedVideo } from "./VideoPicker";

/**
 * A new video post (/explore/videos/new): one clip of up to 30 s, made to fit on the device, with its poster, a caption,
 * a place, topics and who may comment. Only while FITX has videos switched on (explore_video); otherwise the page says
 * videos are paused and offers nothing to press but the way back.
 */
export function VideoComposer() {
  const { db, userId, me, profile } = useReadyExplore();
  const router = useRouter();
  const [video, setVideo] = useState<PreparedVideo | null>(null);
  const [caption, setCaption] = useState("");
  const [location, setLocation] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [policy, setPolicy] = useState<CommentPolicy>(profile.default_comment_policy);
  const [alt, setAlt] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (me.videos !== true) {
    return (
      <div className={`${exploreStyles.narrow} flex flex-col gap-6`}>
        <PageHeader title="New video" />
        <div className={exploreStyles.empty}>
          <span className={exploreStyles.emptyMark}><CirclePause size={26} aria-hidden="true" /></span>
          <h2 className={exploreStyles.emptyTitle}>Videos are paused by FITX</h2>
          <p className={exploreStyles.emptyText}>FITX is checking videos on phones first. You can share photos and photo stories now.</p>
          <Link href="/explore/new" className="fitx-button fitx-button-secondary">New photo post</Link>
        </div>
      </div>
    );
  }

  async function publish() {
    const storage = createClient()?.storage;
    if (!storage || !video) return;
    const postId = crypto.randomUUID();
    const path = `${userId}/${postId}/0.mp4`;
    const poster = posterPath(userId, postId, 0);
    setError(null);
    setProgress(0.1);
    const upload = await uploadVideo(storage, video, path, poster, setProgress);
    if (upload.error) {
      if (upload.uploaded.length) await storage.from(SOCIAL_BUCKET).remove(upload.uploaded).catch(() => undefined);
      setError(upload.error);
      setProgress(null);
      return;
    }
    try {
      await socialApi.createPost(db, {
        id: postId, caption, location, topics, commentPolicy: policy,
        media: [{ path, width: video.width, height: video.height, alt: alt.trim(), kind: "video", poster_path: poster, duration_ms: video.durationMs }],
      });
      setProgress(1);
      toast.success("Video posted");
      router.push(`/explore/videos?v=${postId}`);
    } catch (failure) {
      await storage.from(SOCIAL_BUCKET).remove(upload.uploaded).catch(() => undefined);
      setError(toSocialError(failure).message);
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <div className={`${exploreStyles.narrow} flex flex-col gap-6`}>
      <PageHeader title="New video" />
      <section aria-label="Video">
        <VideoPicker target="post" onChange={setVideo} disabled={busy} />
      </section>
      <div className={exploreStyles.form}>
        {video && (
          <div className={exploreStyles.field}>
            <label className={exploreStyles.label} htmlFor="video-alt">Describe the video (for screen readers)</label>
            <input id="video-alt" className="fitx-field" maxLength={SOCIAL_LIMITS.altChars} value={alt} onChange={(event) => setAlt(event.target.value)} />
          </div>
        )}
        <div className={exploreStyles.field}>
          <div className="flex items-center"><label className={exploreStyles.label} htmlFor="video-caption">Caption</label><span className={exploreStyles.counter}>{caption.length}/{SOCIAL_LIMITS.captionChars}</span></div>
          <textarea id="video-caption" className="fitx-field" rows={3} maxLength={SOCIAL_LIMITS.captionChars} placeholder="Add #hashtags and @mentions" value={caption} onChange={(event) => setCaption(event.target.value)} />
        </div>
        <div className={exploreStyles.field}>
          <label className={exploreStyles.label} htmlFor="video-location">Place (optional)</label>
          <input id="video-location" className="fitx-field" maxLength={SOCIAL_LIMITS.locationChars} placeholder="Gym, park or city" value={location} onChange={(event) => setLocation(event.target.value)} />
        </div>
        <div className={exploreStyles.field}><span className={exploreStyles.label}>Topics</span><TopicPicker value={topics} onChange={setTopics} /></div>
        <div className={exploreStyles.field}>
          <span className={exploreStyles.label}>Comments</span>
          <Segmented label="Who can comment" options={COMMENT_POLICY_OPTIONS} value={policy} onChange={setPolicy} block />
        </div>
        <p className={exploreStyles.note}>
          {profile.is_private ? "Only your approved followers will see this." : "Anyone on FITX can see this."} Only this video and these words are shared, never your workouts, food or body data.
        </p>
        {error && <p className={exploreStyles.alert} role="alert">{error}</p>}
        {busy && (
          <div className={exploreStyles.progress} role="progressbar" aria-label="Posting" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)}>
            <div className={exploreStyles.progressBar} style={{ transform: `scaleX(${progress ?? 0})` }} />
          </div>
        )}
        <button type="button" className="fitx-button" disabled={!video || busy} onClick={() => void publish()}>{busy ? "Posting…" : "Share video"}</button>
      </div>
    </div>
  );
}
