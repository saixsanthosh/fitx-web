"use client";

import { useEffect, useState } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { normaliseUsername, SOCIAL_LIMITS, socialApi, toSocialError, USERNAME_HELP, usernameProblem, type CommentPolicy, type MyProfile } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import { COMMENT_POLICY_OPTIONS } from "./EditPostSheet";
import { SwitchRow } from "./Switch";
import styles from "./Explore.module.css";

type Props = {
  db: Db;
  initial: { username: string; displayName: string; bio: string; isPrivate: boolean; commentPolicy: CommentPolicy };
  submitLabel: string;
  /** The first-time form leaves out the bio and comment default (they can be set later). */
  compact?: boolean;
  onSaved: (profile: MyProfile) => void;
};

/** The member's Explore identity: username (checked as they type), name, bio, privacy and comment default. */
export function ProfileForm({ db, initial, submitLabel, compact = false, onSaved }: Props) {
  const [username, setUsername] = useState(initial.username);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [isPrivate, setPrivate] = useState(initial.isPrivate);
  const [policy, setPolicy] = useState<CommentPolicy>(initial.commentPolicy);
  const [availability, setAvailability] = useState<{ name: string; free: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const name = normaliseUsername(username);
  const problem = name ? usernameProblem(name) : null;
  const unchanged = name === normaliseUsername(initial.username) && initial.username !== "";

  useEffect(() => {
    if (!name || problem || unchanged) return;
    const timer = window.setTimeout(() => {
      void socialApi.usernameAvailable(db, name).then((free) => setAvailability({ name, free })).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [db, name, problem, unchanged]);

  const taken = availability?.name === name && !availability.free;
  const canSave = Boolean(name) && !problem && !taken && displayName.trim().length > 0 && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await socialApi.saveProfile(db, { username: name, displayName: displayName.trim(), bio, isPrivate, commentPolicy: policy }));
    } catch (failure) {
      setError(toSocialError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="social-username">Username</label>
        <input
          id="social-username"
          className="fitx-field"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={31}
          value={username}
          aria-describedby="social-username-help"
          aria-invalid={Boolean(problem || taken)}
          onChange={(event) => setUsername(event.target.value)}
        />
        <p id="social-username-help" className={problem || taken ? styles.hintBad : availability?.name === name && availability.free ? styles.hintGood : styles.hint} aria-live="polite">
          {problem ? USERNAME_HELP[problem] : taken ? "That username is taken." : availability?.name === name && availability.free ? `@${name} is free.` : "Letters, numbers, full stops and underscores."}
        </p>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="social-name">Name</label>
        <input id="social-name" className="fitx-field" maxLength={SOCIAL_LIMITS.displayNameChars} value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" />
      </div>
      {!compact && (
        <div className={styles.field}>
          <div className="flex items-center"><label className={styles.label} htmlFor="social-bio">Bio</label><span className={styles.counter}>{bio.length}/{SOCIAL_LIMITS.bioChars}</span></div>
          <textarea id="social-bio" className="fitx-field" rows={3} maxLength={SOCIAL_LIMITS.bioChars} value={bio} onChange={(event) => setBio(event.target.value)} />
        </div>
      )}
      <div>
        <SwitchRow id="social-private" label="Private account" help="Only followers you approve see your posts." checked={isPrivate} onChange={setPrivate} />
      </div>
      {!compact && (
        <div className={styles.field}>
          <span className={styles.label} id="social-comments-label">Who can comment on new posts</span>
          <Segmented label="Who can comment on new posts" options={COMMENT_POLICY_OPTIONS} value={policy} onChange={setPolicy} block />
        </div>
      )}
      {error && <p className={styles.alert} role="alert">{error}</p>}
      <button type="submit" className="fitx-button" disabled={!canSave}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}
