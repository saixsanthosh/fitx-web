"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { postPhotoPath, SOCIAL_BUCKET, SOCIAL_LIMITS, toSocialError, type SocialPost } from "@/lib/social";
import { compressPhoto, type CompressedPhoto } from "@/lib/social/compress";
import { communitiesApi } from "@/lib/social/communities";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "../Avatar";
import { useReadyExplore } from "../ExploreContext";
import styles from "./Community.module.css";

const MAX_PHOTOS = 4;
type Picked = { key: string; photo: CompressedPhoto; preview: string };

type Props = {
  /** Exactly one of the two. */
  communityId?: string;
  challengeId?: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  onPosted: (post: SocialPost & { entry?: { value: number } }) => void;
};

/**
 * A community discussion (text, with up to four photos) or a challenge progress share. The value beside a progress
 * share is the member's computed entry, added by the database; nothing here lets the member type one.
 */
export function GroupComposer({ communityId, challengeId, label, placeholder, submitLabel, onPosted }: Props) {
  const { db, userId, profile } = useReadyExplore();
  const [text, setText] = useState("");
  const [items, setItems] = useState<Picked[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [busy, setBusy] = useState(false);
  const previews = useRef<string[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  async function add(files: FileList) {
    const take = [...files].filter((file) => !file.type || file.type.startsWith("image/")).slice(0, Math.max(0, MAX_PHOTOS - items.length - preparing));
    setPreparing((count) => count + take.length);
    for (const file of take) {
      try {
        const photo = await compressPhoto(file);
        const preview = URL.createObjectURL(photo.blob);
        previews.current.push(preview);
        setItems((current) => (current.length >= MAX_PHOTOS ? current : [...current, { key: crypto.randomUUID(), photo, preview }]));
      } catch (failure) {
        toast.error(failure instanceof Error ? failure.message : "That photo could not be used.");
      } finally {
        setPreparing((count) => count - 1);
      }
    }
  }

  async function post() {
    const caption = text.trim();
    if (busy || (!caption && !items.length)) return;
    const storage = createClient()?.storage;
    if (items.length && !storage) return;
    setBusy(true);
    const id = crypto.randomUUID();
    const uploaded: string[] = [];
    try {
      const media = [];
      for (const [position, item] of items.entries()) {
        const path = postPhotoPath(userId, id, position, item.photo.type);
        const { error } = await storage!.from(SOCIAL_BUCKET).upload(path, item.photo.blob, { contentType: item.photo.type, upsert: false, cacheControl: "31536000" });
        if (error) throw new Error(/limit|exceed|row-level/i.test(error.message) ? "You have reached today’s photo limit. Try again tomorrow." : "A photo did not upload. Try again.");
        uploaded.push(path);
        media.push({ path, width: item.photo.width, height: item.photo.height, alt: "" });
      }
      const created = await communitiesApi.createGroupPost(db, { id, caption, topics: [], media, communityId, challengeId });
      setText("");
      setItems([]);
      // The emptied form's Post button can no longer take focus: the box does, ready for the next one.
      area.current?.focus();
      onPosted(created);
    } catch (failure) {
      if (uploaded.length && storage) await storage.from(SOCIAL_BUCKET).remove(uploaded).catch(() => undefined);
      toast.error(failure instanceof Error && !("key" in failure) && !("code" in failure) ? failure.message : toSocialError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = (text.trim().length > 0 || items.length > 0) && preparing === 0;
  return (
    <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void post(); }}>
      <div className={styles.composerRow}>
        <Avatar user={{ ...profile, id: userId }} size={36} />
        <textarea
          ref={area}
          className={styles.text}
          aria-label={label}
          placeholder={placeholder}
          rows={2}
          maxLength={SOCIAL_LIMITS.captionChars}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      {(items.length > 0 || preparing > 0) && (
        <div className={styles.thumbs}>
          {items.map((item, index) => (
            <div key={item.key} className={styles.thumb}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo being posted */}
              <img src={item.preview} alt={`Photo ${index + 1}`} />
              <button type="button" className={styles.thumbRemove} aria-label={`Remove photo ${index + 1}`} onClick={() => setItems((current) => current.filter((old) => old.key !== item.key))}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
          {Array.from({ length: preparing }, (_, index) => <div key={`p${index}`} className={styles.thumb} aria-hidden="true" />)}
        </div>
      )}
      <div className={styles.composerTools}>
        {items.length + preparing < MAX_PHOTOS ? (
          <label className={styles.attach}>
            <ImagePlus size={18} aria-hidden="true" />Photo
            <input type="file" accept="image/*" multiple className="sr-only" aria-label="Add photos" aria-disabled={busy || undefined}
              onClick={(event) => { if (busy) event.preventDefault(); }}
              onChange={(event) => { if (event.target.files && !busy) void add(event.target.files); event.target.value = ""; }} />
          </label>
        ) : <span />}
        {/* Posting is aria-disabled, not disabled, so the button keeps keyboard focus (D5). */}
        <button type="submit" className="fitx-button aria-disabled:opacity-60" disabled={!ready} aria-disabled={busy || undefined}>
          {busy ? <><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Posting</> : submitLabel}
        </button>
      </div>
    </form>
  );
}
