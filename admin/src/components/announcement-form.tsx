"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { saveAnnouncement, type AnnouncementFormState } from "@/app/(control)/announcements/actions";
import { ANNOUNCEMENT_LIMITS, ANNOUNCEMENT_TONE_LABELS, ANNOUNCEMENT_TONES, type AnnouncementStatus } from "@/lib/announcement-input";

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

export function AnnouncementForm({ defaults = {}, submitLabel, status }: { defaults?: AnnouncementDefaults; submitLabel: string; status?: AnnouncementStatus }) {
  const [state, action, pending] = useActionState<AnnouncementFormState, FormData>(saveAnnouncement, null);
  const live = status === "published";

  // React resets a form after its action runs, which would wipe what the admin typed when the save is
  // refused. Submitting through a transition keeps every field; without JavaScript, the form action
  // below still posts the same data.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  return (
    <form action={action} onSubmit={submit} className="stack-form announcement-form">
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
      {live ? (
        <>
          <p className="field-note">This announcement is published. Saved changes show to signed-in people from their next visit, within these times; there is no separate publish step. People who already dismissed it do not see it again. To work on it privately, choose Back to draft first.</p>
          <label className="check-label"><input type="checkbox" name="confirm_live" value="yes" required />Change the live announcement now</label>
        </>
      ) : (
        <p className="field-note">Saving never publishes. People see an announcement only after you publish it, and only between these times.</p>
      )}
      {state?.error && <p role="alert" className="form-error">{state.error}</p>}
      <button className="primary-button" aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault(); }} type="submit">
        {pending && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
        <span>{pending ? "Saving…" : submitLabel}</span>
      </button>
    </form>
  );
}
