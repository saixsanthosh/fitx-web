"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { saveAnnouncement, type AnnouncementFormState } from "@/app/(control)/announcements/actions";
import { ANNOUNCEMENT_LIMITS, ANNOUNCEMENT_TONE_LABELS, ANNOUNCEMENT_TONES } from "@/lib/announcement-input";

export type AnnouncementDefaults = {
  id?: string;
  title?: string;
  body?: string;
  tone?: string;
  linkUrl?: string | null;
  linkLabel?: string | null;
  /** datetime-local values in IST. */
  startsAt?: string;
  endsAt?: string;
};

export function AnnouncementForm({ defaults = {}, submitLabel }: { defaults?: AnnouncementDefaults; submitLabel: string }) {
  const [state, action, pending] = useActionState<AnnouncementFormState, FormData>(saveAnnouncement, null);
  return (
    <form action={action} className="stack-form announcement-form">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <label>Title<input name="title" required minLength={3} maxLength={ANNOUNCEMENT_LIMITS.title} defaultValue={defaults.title} /></label>
      <label>Message<textarea name="body" required maxLength={ANNOUNCEMENT_LIMITS.body} rows={4} defaultValue={defaults.body} /></label>
      <label>Style<select name="tone" defaultValue={defaults.tone ?? "info"}>{ANNOUNCEMENT_TONES.map((tone) => <option key={tone} value={tone}>{ANNOUNCEMENT_TONE_LABELS[tone]}</option>)}</select></label>
      <div className="form-row">
        <label>Link (optional)<input name="link_url" maxLength={ANNOUNCEMENT_LIMITS.linkUrl} placeholder="/workouts or https://…" defaultValue={defaults.linkUrl ?? ""} /></label>
        <label>Button label<input name="link_label" maxLength={ANNOUNCEMENT_LIMITS.linkLabel} placeholder="Open workouts" defaultValue={defaults.linkLabel ?? ""} /></label>
      </div>
      <div className="form-row">
        <label>Show from (IST, optional)<input type="datetime-local" name="starts_at" defaultValue={defaults.startsAt ?? ""} /></label>
        <label>Show until (IST, optional)<input type="datetime-local" name="ends_at" defaultValue={defaults.endsAt ?? ""} /></label>
      </div>
      <p className="field-note">Saving never publishes. People see an announcement only after you publish it, and only between these times.</p>
      {state?.error && <p role="alert" className="form-error">{state.error}</p>}
      <button className="primary-button" disabled={pending} type="submit">
        {pending && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
        <span>{pending ? "Saving…" : submitLabel}</span>
      </button>
    </form>
  );
}
