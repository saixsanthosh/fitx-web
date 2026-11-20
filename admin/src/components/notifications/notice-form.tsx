"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { sendNotification, type NoticeFormState } from "@/app/(control)/notifications/actions";
import { ANNOUNCEMENT_LIMITS, ANNOUNCEMENT_TONE_LABELS, ANNOUNCEMENT_TONES, type AnnouncementTone } from "@/lib/announcement-input";
import { NOTICE_MAX_TYPED, type NoticeAudience } from "./notice-rules";
import styles from "./notifications.module.css";

/** The composer: who gets it, the words, and a live preview of the banner members will see. */
export function NoticeForm({ canEveryone, recipients }: { canEveryone: boolean; recipients: string }) {
  const [state, action, pending] = useActionState<NoticeFormState, FormData>(sendNotification, null);
  const [audience, setAudience] = useState<NoticeAudience>(recipients || !canEveryone ? "chosen" : "everyone");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tone, setTone] = useState<AnnouncementTone>("info");
  const [label, setLabel] = useState("");

  // Submitting through a transition keeps what was typed when the server refuses it.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  return (
    <div className={styles.composer}>
      <form action={action} onSubmit={submit} className="stack-form">
        <fieldset className={styles.audience}>
          <legend>Send to</legend>
          <label className={styles.choice}>
            <input type="radio" name="audience" value="everyone" checked={audience === "everyone"} disabled={!canEveryone} onChange={() => setAudience("everyone")} />
            <span><strong>Everyone</strong><small>{canEveryone ? "Banner for every signed-in member" : "Needs announcement access"}</small></span>
          </label>
          <label className={styles.choice}>
            <input type="radio" name="audience" value="chosen" checked={audience === "chosen"} onChange={() => setAudience("chosen")} />
            <span><strong>Chosen accounts</strong><small>Only the accounts you list</small></span>
          </label>
        </fieldset>
        {audience === "chosen" && (
          <label>Recipients<textarea name="recipients" rows={4} required defaultValue={recipients} placeholder="Emails or account IDs, one per line" /><span className="field-note">Up to {NOTICE_MAX_TYPED} emails, or select accounts on Users.</span></label>
        )}
        <label>Title<input name="title" required minLength={3} maxLength={ANNOUNCEMENT_LIMITS.title} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Message<textarea name="body" required maxLength={ANNOUNCEMENT_LIMITS.body} rows={4} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        <div className="form-row">
          <label>Style<select name="tone" value={tone} onChange={(event) => setTone(event.target.value as AnnouncementTone)}>{ANNOUNCEMENT_TONES.map((option) => <option key={option} value={option}>{ANNOUNCEMENT_TONE_LABELS[option]}</option>)}</select></label>
          <label>Button label<input name="link_label" maxLength={ANNOUNCEMENT_LIMITS.linkLabel} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Optional" /></label>
        </div>
        <label>Button link<input name="link_url" maxLength={ANNOUNCEMENT_LIMITS.linkUrl} placeholder="/workouts or https://…" /></label>
        {audience === "everyone" && (
          <div className="form-row">
            <label>Show from (IST)<input type="datetime-local" name="starts_at" /></label>
            <label>Show until (IST)<input type="datetime-local" name="ends_at" /></label>
          </div>
        )}
        {state?.error && <p role="alert" className="form-error">{state.error}</p>}
        {state?.sent && <p role="status" className="inline-notice notice-success">{state.sent}</p>}
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden="true" className="spin" size={17} /> : <Send aria-hidden="true" size={16} />}
          <span>{pending ? "Sending…" : audience === "everyone" ? "Publish to everyone" : "Send notice"}</span>
        </button>
      </form>
      <div className={styles.previewWrap} aria-hidden="true">
        <p className={styles.previewLabel}>In the app</p>
        <div className={styles.phone}>
          <span className={styles.notch} />
          <div className={`${styles.banner} ${styles[`tone_${tone}`]}`}>
            <strong>{title || "Title"}</strong>
            <span>{body || "Your message shows here."}</span>
            {label && <em>{label}</em>}
          </div>
          <span className={styles.ghost} />
          <span className={`${styles.ghost} ${styles.short}`} />
          <span className={styles.ghost} />
        </div>
      </div>
    </div>
  );
}
