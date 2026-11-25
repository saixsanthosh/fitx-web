"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { postPhotoPath, SOCIAL_BUCKET, SOCIAL_LIMITS, socialApi, toSocialError, type CommentPolicy } from "@/lib/social";
import { PHOTO_AREA_HINT, shareBlock, shareBlockText } from "@/lib/social/compose";
import { compressPhoto, type CompressedPhoto } from "@/lib/social/compress";
import { createClient } from "@/lib/supabase/client";
import { COMMENT_POLICY_OPTIONS } from "./EditPostSheet";
import { useReadyExplore } from "./ExploreContext";
import { TopicPicker } from "./TopicPicker";
import styles from "./Explore.module.css";

type Picked = { key: string; photo: CompressedPhoto; preview: string; alt: string };

/**
 * A new photo post: 1 to 10 photos (made smaller on the device first), caption, place, topics and who may comment.
 * A caption alone cannot be shared here (only communities take text posts): the photo area and the reason under Share
 * post say so.
 */
export function ComposerView() {
  const { db, userId, profile } = useReadyExplore();
  const router = useRouter();
  const [items, setItems] = useState<Picked[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [caption, setCaption] = useState("");
  const [location, setLocation] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [policy, setPolicy] = useState<CommentPolicy>(profile.default_comment_policy);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** How often Share post was pressed while it could not go (the reason is announced each time). */
  const [nudged, setNudged] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);

  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  async function add(files: FileList | File[]) {
    const list = [...files].filter((file) => !file.type || file.type.startsWith("image/"));
    const room = SOCIAL_LIMITS.photosPerPost - items.length - preparing;
    if (list.length > room) toast.message(`A post holds up to ${SOCIAL_LIMITS.photosPerPost} photos.`);
    const take = list.slice(0, Math.max(0, room));
    if (!take.length) return;
    setError(null);
    setNudged(0);
    setPreparing((count) => count + take.length);
    for (const file of take) {
      try {
        const photo = await compressPhoto(file);
        const preview = URL.createObjectURL(photo.blob);
        previews.current.push(preview);
        setItems((current) => current.length >= SOCIAL_LIMITS.photosPerPost ? current : [...current, { key: crypto.randomUUID(), photo, preview, alt: "" }]);
      } catch (failure) {
        toast.error(failure instanceof Error ? failure.message : "That photo could not be used.");
      } finally {
        setPreparing((count) => count - 1);
      }
    }
  }

  const move = (index: number, by: number) => setItems((current) => {
    const next = [...current];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    return next;
  });
  const drop = (key: string) => setItems((current) => current.filter((item) => item.key !== key));

  async function publish() {
    const storage = createClient()?.storage;
    if (!storage || !items.length) return;
    const postId = crypto.randomUUID();
    const uploaded: string[] = [];
    setError(null);
    setProgress(0);
    try {
      const media = [];
      for (const [position, item] of items.entries()) {
        const path = postPhotoPath(userId, postId, position, item.photo.type);
        const { error: uploadError } = await storage.from(SOCIAL_BUCKET).upload(path, item.photo.blob, { contentType: item.photo.type, upsert: false, cacheControl: "31536000" });
        if (uploadError) throw new Error(/limit|exceed|row-level/i.test(uploadError.message) ? "You have reached today’s photo limit. Try again tomorrow." : "A photo did not upload. Try again.");
        uploaded.push(path);
        media.push({ path, width: item.photo.width, height: item.photo.height, alt: item.alt.trim() });
        setProgress((position + 1) / (items.length + 1));
      }
      const post = await socialApi.createPost(db, { id: postId, caption, location, topics, commentPolicy: policy, media });
      setProgress(1);
      toast.success("Posted");
      router.push(`/explore/p/${post.id}`);
    } catch (failure) {
      if (uploaded.length) await storage.from(SOCIAL_BUCKET).remove(uploaded).catch(() => undefined);
      setError(failure instanceof Error && !("code" in failure) && !("key" in failure) ? failure.message : toSocialError(failure).message);
      setProgress(null);
    }
  }

  const busy = progress !== null;
  const block = shareBlock({ media: items.length, preparing, posting: busy });
  const reason = shareBlockText(block);
  return (
    <div className={`${styles.narrow} flex flex-col gap-6`}>
      <PageHeader title="New post" />
      <section
        aria-label="Photos"
        className={styles.picker}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void add(event.dataTransfer.files); }}
      >
        {items.map((item, index) => (
          <div key={item.key} className={styles.pick}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo being posted */}
            <img src={item.preview} alt={`Photo ${index + 1}`} />
            <span className={styles.pickIndex} aria-hidden="true">{index + 1}</span>
            <div className={styles.pickTools}>
              <button type="button" className={styles.pickTool} aria-label={`Move photo ${index + 1} earlier`} disabled={index === 0 || busy} onClick={() => move(index, -1)}><ArrowLeft size={15} aria-hidden="true" /></button>
              <button type="button" className={styles.pickTool} aria-label={`Remove photo ${index + 1}`} disabled={busy} onClick={() => drop(item.key)}><X size={15} aria-hidden="true" /></button>
              <button type="button" className={styles.pickTool} aria-label={`Move photo ${index + 1} later`} disabled={index === items.length - 1 || busy} onClick={() => move(index, 1)}><ArrowRight size={15} aria-hidden="true" /></button>
            </div>
          </div>
        ))}
        {Array.from({ length: preparing }, (_, index) => <div key={`p${index}`} className={`${styles.pick} ${styles.skeleton}`} aria-hidden="true" />)}
        {items.length + preparing < SOCIAL_LIMITS.photosPerPost && (
          <label className={`${styles.drop} ${items.length + preparing === 0 ? styles.dropBig : ""}`} style={dragging ? { borderColor: "var(--fitx-primary)" } : undefined}>
            <ImagePlus size={items.length ? 22 : 34} aria-hidden="true" />
            <span>{items.length ? "Add more" : "Add photos"}</span>
            {!items.length && <span className={styles.hint}>{PHOTO_AREA_HINT}</span>}
            <input ref={input} type="file" accept="image/*" multiple className="sr-only" disabled={busy} aria-label="Add photos" onChange={(event) => { if (event.target.files) void add(event.target.files); event.target.value = ""; }} />
          </label>
        )}
      </section>

      {items.length > 0 && (
        <details className={styles.panel}>
          <summary className={`${styles.label} cursor-pointer`}>Describe photos (for screen readers)</summary>
          <div className="mt-3 flex flex-col gap-3">
            {items.map((item, index) => (
              <div key={item.key} className={styles.field}>
                <label className={styles.hint} htmlFor={`alt-${item.key}`}>Photo {index + 1}</label>
                <input id={`alt-${item.key}`} className="fitx-field" maxLength={SOCIAL_LIMITS.altChars} value={item.alt} onChange={(event) => setItems((current) => current.map((old) => old.key === item.key ? { ...old, alt: event.target.value } : old))} />
              </div>
            ))}
          </div>
        </details>
      )}

      <div className={styles.form}>
        <div className={styles.field}>
          <div className="flex items-center"><label className={styles.label} htmlFor="post-caption">Caption</label><span className={styles.counter}>{caption.length}/{SOCIAL_LIMITS.captionChars}</span></div>
          <textarea id="post-caption" className="fitx-field" rows={4} maxLength={SOCIAL_LIMITS.captionChars} placeholder="Add #hashtags and @mentions" value={caption} onChange={(event) => setCaption(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="post-location">Place (optional)</label>
          <input id="post-location" className="fitx-field" maxLength={SOCIAL_LIMITS.locationChars} placeholder="Gym, park or city" value={location} onChange={(event) => setLocation(event.target.value)} />
        </div>
        <div className={styles.field}><span className={styles.label}>Topics</span><TopicPicker value={topics} onChange={setTopics} /></div>
        <div className={styles.field}>
          <span className={styles.label}>Comments</span>
          <Segmented label="Who can comment" options={COMMENT_POLICY_OPTIONS} value={policy} onChange={setPolicy} block />
        </div>
        <p className={styles.note}>
          {profile.is_private ? "Only your approved followers will see this." : "Anyone on FITX can see this."} Only these photos and words are shared, never your workouts, food or body data.
        </p>
        {error && <p className={styles.alert} role="alert">{error}</p>}
        {busy && (
          <div className={styles.progress} role="progressbar" aria-label="Posting" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)}>
            <div className={styles.progressBar} style={{ transform: `scaleX(${progress ?? 0})` }} />
          </div>
        )}
        {/* Not disabled: a member who cannot share yet can still reach the button and hears why (bug 61). */}
        <button
          type="button"
          className="fitx-button aria-disabled:opacity-60"
          aria-disabled={block !== null || undefined}
          aria-describedby={reason ? "share-reason" : undefined}
          onClick={() => {
            if (block === "posting") return;
            if (block) { setNudged((count) => count + 1); return; }
            void publish();
          }}
        >
          {busy ? "Posting…" : "Share post"}
        </button>
        {/* Pressed while it cannot go, the reason is said again (a new alert) and drawn as a problem. */}
        {reason && <p id="share-reason" key={nudged} role={nudged ? "alert" : undefined} className={nudged ? styles.hintBad : styles.hint}>{reason}</p>}
      </div>
    </div>
  );
}
