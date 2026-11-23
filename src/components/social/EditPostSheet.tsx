"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { SOCIAL_LIMITS, socialApi, toSocialError, type CommentPolicy, type SocialPost } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import { TopicPicker } from "./TopicPicker";
import styles from "./Explore.module.css";

export const COMMENT_POLICY_OPTIONS = [
  { value: "everyone" as const, label: "Everyone" },
  { value: "followers" as const, label: "Followers" },
  { value: "off" as const, label: "Off" },
];

/** Edits a member's own post: caption, place, topics and who may comment. Photos stay as posted. */
export function EditPostSheet({ db, post, onClose, onSaved }: { db: Db; post: SocialPost | null; onClose: () => void; onSaved: (post: SocialPost) => void }) {
  return (
    <Sheet open={post !== null} onClose={onClose} title="Edit post">
      {post && <EditForm key={post.id} db={db} post={post} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function EditForm({ db, post, onClose, onSaved }: { db: Db; post: SocialPost; onClose: () => void; onSaved: (post: SocialPost) => void }) {
  const [caption, setCaption] = useState(post.caption);
  const [location, setLocation] = useState(post.location ?? "");
  const [topics, setTopics] = useState<string[]>(post.topics);
  const [policy, setPolicy] = useState<CommentPolicy>(post.comment_policy);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const saved = await socialApi.updatePost(db, post.id, { caption, location, topics, commentPolicy: policy });
      onSaved(saved);
      toast.success("Post updated");
      onClose();
    } catch (error) {
      toast.error(toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <div className="flex items-center"><label className={styles.label} htmlFor="edit-caption">Caption</label><span className={styles.counter}>{caption.length}/{SOCIAL_LIMITS.captionChars}</span></div>
        <textarea id="edit-caption" className="fitx-field" rows={5} maxLength={SOCIAL_LIMITS.captionChars} value={caption} onChange={(event) => setCaption(event.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="edit-location">Place (optional)</label>
        <input id="edit-location" className="fitx-field" maxLength={SOCIAL_LIMITS.locationChars} value={location} onChange={(event) => setLocation(event.target.value)} />
      </div>
      <div className={styles.field}><span className={styles.label}>Topics</span><TopicPicker value={topics} onChange={setTopics} /></div>
      <div className={styles.field}>
        <span className={styles.label}>Comments</span>
        <Segmented label="Who can comment" options={COMMENT_POLICY_OPTIONS} value={policy} onChange={setPolicy} block />
      </div>
      <button type="button" className="fitx-button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button>
    </div>
  );
}
