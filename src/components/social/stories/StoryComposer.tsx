"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Clapperboard, ImagePlus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { posterPath, SOCIAL_BUCKET, SOCIAL_LIMITS, socialApi, toSocialError } from "@/lib/social";
import { compressPhoto, type CompressedPhoto } from "@/lib/social/compress";
import { storyFilePath } from "@/lib/social/stories";
import { createClient } from "@/lib/supabase/client";
import { useReadyExplore } from "../ExploreContext";
import { useFocusAfterRender } from "../useFocusAfterRender";
import exploreStyles from "../Explore.module.css";
import { uploadProblem, uploadVideo } from "../videos/upload";
import { VideoPicker, type PreparedVideo } from "../videos/VideoPicker";
import { trayChanged } from "./trayStore";
import styles from "./Stories.module.css";

type Kind = "photo" | "video";

/**
 * A new story (/explore/stories/new): one photo (made smaller on the device, its metadata dropped) or, while FITX has
 * videos on, one clip of up to 15 s, with an optional caption. It lives 24 hours. Who sees it follows the account's
 * privacy, as posts do.
 */
export function StoryComposer() {
  const { db, userId, me, profile } = useReadyExplore();
  const router = useRouter();
  const videosOn = me.videos === true;
  const [kind, setKind] = useState<Kind | null>(null);
  const [photo, setPhoto] = useState<{ photo: CompressedPhoto; url: string } | null>(null);
  const [video, setVideo] = useState<PreparedVideo | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  const focusAfter = useFocusAfterRender();

  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  async function pickPhoto(file: File) {
    if (preparing) return;
    setError(null);
    setPreparing(true);
    try {
      const compressed = await compressPhoto(file);
      const url = URL.createObjectURL(compressed.blob);
      urls.current.push(url);
      setPhoto({ photo: compressed, url });
      setKind("photo");
      // The choices give way to the caption and Share story: focus goes on to the caption, not to the page (D5).
      focusAfter("story-caption");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That photo could not be used.");
    } finally {
      setPreparing(false);
    }
  }

  function reset() {
    if (busy) return;
    setKind(null);
    setPhoto(null);
    setVideo(null);
    setError(null);
    // Start again takes the form away: focus goes to the first choice that comes back.
    focusAfter("story-photo");
  }

  const ready = (kind === "photo" && photo) || (kind === "video" && video);
  async function share() {
    const storage = createClient()?.storage;
    if (!storage || busy || !ready) return;
    const storyId = crypto.randomUUID();
    setBusy(true);
    setError(null);
    let uploaded: string[] = [];
    try {
      if (kind === "photo" && photo) {
        const path = storyFilePath(userId, storyId, "image", photo.photo.type);
        const { error: uploadError } = await storage.from(SOCIAL_BUCKET).upload(path, photo.photo.blob, { contentType: photo.photo.type, upsert: false, cacheControl: "31536000" });
        if (uploadError) throw new Error(uploadProblem(uploadError.message, "photo"));
        uploaded = [path];
        await socialApi.createStory(db, { id: storyId, kind: "image", path, posterPath: null, width: photo.photo.width, height: photo.photo.height, durationMs: null, caption });
      } else if (kind === "video" && video) {
        const path = storyFilePath(userId, storyId, "video");
        const poster = posterPath(userId, storyId, 0);
        const upload = await uploadVideo(storage, video, path, poster);
        uploaded = upload.uploaded;
        if (upload.error) throw new Error(upload.error);
        await socialApi.createStory(db, { id: storyId, kind: "video", path, posterPath: poster, width: video.width, height: video.height, durationMs: video.durationMs, caption });
      } else {
        return;
      }
      trayChanged(db);
      toast.success("Story shared");
      router.push(`/explore/stories/${profile.username}`);
    } catch (failure) {
      if (uploaded.length) await storage.from(SOCIAL_BUCKET).remove(uploaded).catch(() => undefined);
      setError(failure instanceof Error && !("key" in failure) && !("code" in failure) ? failure.message : toSocialError(failure).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New story" />
      <div className={styles.compose}>
        {/* While a video is being chosen or recorded, the picker shows it; the frame comes back once it is ready. */}
        {(kind !== "video" || video) && <figure className={styles.preview} aria-label="Story preview">
          {kind === "photo" && photo && (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo being shared
            <img src={photo.url} alt="Your story photo" className={styles.previewMedia} />
          )}
          {kind === "video" && video && <video src={video.url} className={styles.previewMedia} muted playsInline loop autoPlay aria-label="Your video" />}
          {!ready && (
            <span className={styles.previewEmpty}>
              <ImagePlus size={30} aria-hidden="true" />
              <span>Your story shows here. It is gone after 24 hours.</span>
            </span>
          )}
          {ready && caption.trim() && <figcaption className={styles.previewCaption}>{caption.trim()}</figcaption>}
        </figure>}

        <div className="flex flex-col gap-5">
          {!kind && (
            <div className={styles.choices}>
              <label className={styles.choice}>
                <span className={styles.choiceIcon} aria-hidden="true"><ImagePlus size={22} /></span>
                <span className={styles.choiceText}>
                  <span className={styles.choiceLabel}>{preparing ? "Preparing the photo…" : "Photo"}</span>
                  <span className={styles.choiceHint}>Made smaller on your device first.</span>
                </span>
                {/* Preparing is aria-disabled, not disabled, so a refused photo leaves focus here with the reason (D5). */}
                <input id="story-photo" type="file" accept="image/*" className="sr-only" aria-label="Add a photo" aria-disabled={preparing || undefined}
                  onClick={(event) => { if (preparing) event.preventDefault(); }}
                  onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void pickPhoto(file); }} />
              </label>
              {videosOn && (
                <button type="button" className={styles.choice} onClick={() => { setKind("video"); focusAfter("video-choose"); }}>
                  <span className={styles.choiceIcon} aria-hidden="true"><Clapperboard size={22} /></span>
                  <span className={styles.choiceText}>
                    <span className={styles.choiceLabel}>Video</span>
                    <span className={styles.choiceHint}>Up to 15 seconds.</span>
                  </span>
                </button>
              )}
            </div>
          )}
          {kind === "video" && <VideoPicker target="story" onChange={setVideo} disabled={busy} preview={false} />}

          {kind && (
            <div className={exploreStyles.form}>
              <div className={exploreStyles.field}>
                <div className="flex items-center"><label className={exploreStyles.label} htmlFor="story-caption">Caption (optional)</label><span className={exploreStyles.counter}>{caption.length}/{SOCIAL_LIMITS.storyCaptionChars}</span></div>
                <textarea id="story-caption" className="fitx-field" rows={2} maxLength={SOCIAL_LIMITS.storyCaptionChars} value={caption} onChange={(event) => setCaption(event.target.value)} />
              </div>
              <p className={exploreStyles.note}>
                {profile.is_private ? "Only your approved followers will see this story." : "Anyone on FITX can see this story."} It is gone after 24 hours.
              </p>
              {error && <p className={exploreStyles.alert} role="alert">{error}</p>}
              <div className="flex flex-wrap gap-2">
                {/* Sharing is aria-disabled, not disabled: both buttons keep keyboard focus while it goes (D5). */}
                <button type="button" className="fitx-button aria-disabled:opacity-60" disabled={!ready} aria-disabled={busy || undefined} onClick={() => void share()}>{busy ? "Sharing…" : "Share story"}</button>
                <button type="button" className="fitx-button fitx-button-secondary aria-disabled:opacity-60" aria-disabled={busy || undefined} onClick={reset}><RotateCcw size={16} aria-hidden="true" />Start again</button>
              </div>
            </div>
          )}
          {!kind && error && <p className={exploreStyles.alert} role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
