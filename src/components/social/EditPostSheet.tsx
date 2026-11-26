"use client";

import { useId, useState, type FormEvent } from "react";
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
 * so inside the sheet, just above Save changes (D6); "Post updated" is a toast once the sheet has closed.
 *
 * Save changes sits in the sheet's actions row, as in every other Explore sheet that acts, not at the end of the form:
 * there a failure's message, which takes its room from the content, pushed the focused button out of view until the
 * member scrolled (reg-explore-1). The button submits the form by its id, so it stays one Tab stop after the fields.
 */
export function EditPostSheet({ db, post, onClose, onSaved }: { db: Db; post: SocialPost | null; onClose: () => void; onSaved: (post: SocialPost) => void }) {
  const { notice, show, clear } = useNotice();
  const [busy, setBusy] = useState(false);
  const formId = `${useId()}-edit-post`;
  const close = () => { clear(); onClose(); };
  return (
    <Sheet
      open={post !== null}
      onClose={close}
      title="Edit post"
      notice={notice}
      footer={
        // Busy is aria-disabled, not disabled: a disabled button drops keyboard focus to the page (D5).
        <button type="submit" form={formId} className="fitx-button w-full aria-disabled:opacity-60" aria-disabled={busy || undefined}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      }
    >
      {post && <EditForm key={post.id} id={formId} db={db} post={post} busy={busy} onBusy={setBusy} onClose={close} onSaved={onSaved} onFailed={(text) => show("error", text)} onTry={clear} />}
    </Sheet>
  );
}

function EditForm({ id, db, post, busy, onBusy, onClose, onSaved, onFailed, onTry }: {
  id: string; db: Db; post: SocialPost; busy: boolean; onBusy: (busy: boolean) => void; onClose: () => void;
  onSaved: (post: SocialPost) => void; onFailed: (text: string) => void; onTry: () => void;
}) {
  const [caption, setCaption] = useState(post.caption);
  const [location, setLocation] = useState(post.location ?? "");
  const [topics, setTopics] = useState<string[]>(post.topics);
  const [policy, setPolicy] = useState<CommentPolicy>(post.comment_policy);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    onBusy(true);
    onTry();
    try {
      const saved = await socialApi.updatePost(db, post.id, { caption, location, topics, commentPolicy: policy });
      onSaved(saved);
      onClose();
      toast.success("Post updated");
    } catch (error) {
      onFailed(toSocialError(error).message);
    } finally {
      onBusy(false);
    }
  }
  return (
    <form id={id} className={styles.form} onSubmit={(event) => void save(event)} noValidate>
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
    </form>
  );
}
