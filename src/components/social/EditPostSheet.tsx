"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { SOCIAL_LIMITS, socialApi, toSocialError, type CommentPolicy, type SocialPost } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import { TopicPicker } from "./TopicPicker";
import { useNotice } from "./useNotice";
import styles from "./Explore.module.css";

export const COMMENT_POLICY_OPTIONS = [
  { value: "everyone" as const, label: "Everyone" },
  { value: "followers" as const, label: "Followers" },
  { value: "off" as const, label: "Off" },
];

/**
 * Edits a member's own post: caption, place, topics and who may comment. Photos stay as posted. A save that fails says
 * so inside the sheet, beside the form (D6); "Post updated" is a toast once the sheet has closed.
 */
export function EditPostSheet({ db, post, onClose, onSaved }: { db: Db; post: SocialPost | null; onClose: () => void; onSaved: (post: SocialPost) => void }) {
  const { notice, show, clear } = useNotice();
  const close = () => { clear(); onClose(); };
  return (
    <Sheet open={post !== null} onClose={close} title="Edit post" notice={notice}>
      {post && <EditForm key={post.id} db={db} post={post} onClose={close} onSaved={onSaved} onFailed={(text) => show("error", text)} onTry={clear} />}
    </Sheet>
  );
}

function EditForm({ db, post, onClose, onSaved, onFailed, onTry }: {
  db: Db; post: SocialPost; onClose: () => void; onSaved: (post: SocialPost) => void; onFailed: (text: string) => void; onTry: () => void;
}) {
  const [caption, setCaption] = useState(post.caption);
  const [location, setLocation] = useState(post.location ?? "");
  const [topics, setTopics] = useState<string[]>(post.topics);
  const [policy, setPolicy] = useState<CommentPolicy>(post.comment_policy);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return;
    setBusy(true);
    onTry();
    try {
      const saved = await socialApi.updatePost(db, post.id, { caption, location, topics, commentPolicy: policy });
      onSaved(saved);
      onClose();
      toast.success("Post updated");
    } catch (error) {
      onFailed(toSocialError(error).message);
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
      <button type="button" className="fitx-button aria-disabled:opacity-60" aria-disabled={busy || undefined} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button>
    </div>
  );
}
