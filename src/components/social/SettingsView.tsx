"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Camera, Clapperboard, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Sheet } from "@/components/ui/Sheet";
import { ageOn, avatarPath, fullDate, plural, SOCIAL_BUCKET, SOCIAL_LIMITS, socialApi, toSocialError, type MyContent, type NotificationPrefs, type SocialAuthor } from "@/lib/social";
import { focusAfterRemoval } from "@/lib/social/focus";
import { CREATE_OPTIONS, EXPLORE_RAIL } from "@/lib/social/rail";
import { compressPhoto } from "@/lib/social/compress";
import { forgetPhotoUrls } from "@/lib/social/media-urls";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./Avatar";
import { useReadyExplore } from "./ExploreContext";
import { ProfileForm } from "./ProfileForm";
import { SocialPhoto } from "./SocialPhoto";
import { SwitchRow } from "./Switch";
import { useAsync } from "./useAsync";
import { useFocusAfterRender } from "./useFocusAfterRender";
import { useNotice } from "./useNotice";
import styles from "./Explore.module.css";

const ready = (key: string) => EXPLORE_RAIL.some((entry) => entry.key === key && entry.ready);
const storiesReady = CREATE_OPTIONS.some((option) => option.key === "story" && option.ready);

/** The switches, each shown only once its part of Explore exists (and the database knows the setting). */
const PREFS: { key: keyof NotificationPrefs; label: string; shown: boolean }[] = [
  { key: "follows", label: "New followers", shown: true },
  { key: "follow_requests", label: "Follow requests", shown: true },
  { key: "likes", label: "Likes", shown: true },
  { key: "comments", label: "Comments and replies", shown: true },
  { key: "mentions", label: "Mentions", shown: true },
  { key: "stories", label: "Story likes and replies", shown: storiesReady },
  { key: "messages", label: "Messages and message requests", shown: ready("messages") },
  { key: "communities", label: "Communities", shown: ready("community") },
  // Release 2a sends challenge badges only (no invitations yet): say "Challenge invites and badges" once they ship.
  { key: "challenges", label: "Challenge badges", shown: ready("community") },
];

/**
 * Explore settings: profile and picture, privacy, comment default, notifications, "Your Explore content", blocked and
 * restricted accounts, and "Add your date of birth". While Explore is paused or the account suspended, only the parts
 * the database still allows are shown: the member's own content, safety and the date of birth.
 */
export function SettingsView() {
  const { db, profile, me, setMe, closed } = useReadyExplore();
  return (
    <div className={`${styles.narrow} flex flex-col gap-6`}>
      <PageHeader title="Explore settings" />
      {!closed && <section className={styles.panel} aria-labelledby="settings-profile">
        <h2 id="settings-profile" className={styles.panelTitle}>Profile</h2>
        <AvatarPicker />
        <div className="mt-5">
          <ProfileForm
            db={db}
            submitLabel="Save profile"
            initial={{ username: profile.username, displayName: profile.display_name, bio: profile.bio, isPrivate: profile.is_private, commentPolicy: profile.default_comment_policy }}
            onSaved={(saved) => { setMe({ ...me, profile: saved }); toast.success("Profile saved"); }}
          />
        </div>
      </section>}
      {!closed && <Notifications />}
      {!closed && ready("messages") && me.age_band === "adult" && <MessagesLink />}
      <BirthDate />
      <YourContent />
      <Safety />
      <p className={styles.note}>
        Explore never shows your workouts, food, weight or other FITX data. Only what you post, your profile and who you follow are shared, as your privacy setting allows.{" "}
        <Link href={`/explore/u/${profile.username}`} className="underline">View your profile</Link>
      </p>
    </div>
  );
}

function AvatarPicker() {
  const { db, userId, me, profile, setMe } = useReadyExplore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const focusAfter = useFocusAfterRender();
  async function change(file: File) {
    const storage = createClient()?.storage;
    if (!storage || busy) return;
    setBusy(true);
    let uploaded: string | null = null;
    try {
      const photo = await compressPhoto(file, 480);
      const path = avatarPath(userId, photo.type);
      const { error } = await storage.from(SOCIAL_BUCKET).upload(path, photo.blob, { contentType: photo.type, upsert: false, cacheControl: "3600" });
      if (error) throw new Error("The photo did not upload. Try again.");
      uploaded = path;
      const old = await socialApi.setAvatar(db, path);
      if (old) {
        await storage.from(SOCIAL_BUCKET).remove([old]);
        forgetPhotoUrls([old]);
      }
      setMe({ ...me, profile: { ...profile, avatar_path: path } });
      toast.success("Profile picture updated");
    } catch (error) {
      if (uploaded) await storage.from(SOCIAL_BUCKET).remove([uploaded]).catch(() => undefined);
      toast.error(error instanceof Error && !("code" in error) ? error.message : toSocialError(error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function clear() {
    if (busy) return;
    const storage = createClient()?.storage;
    setBusy(true);
    try {
      const old = await socialApi.setAvatar(db, null);
      if (old && storage) {
        await storage.from(SOCIAL_BUCKET).remove([old]);
        forgetPhotoUrls([old]);
      }
      setMe({ ...me, profile: { ...profile, avatar_path: null } });
      // Remove goes with the photo: focus moves to Change photo (it used to fall to the page body).
      focusAfter("explore-avatar-input");
    } catch (error) {
      toast.error(toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.row}>
      <Avatar user={profile} size={72} />
      <div className="flex flex-wrap gap-2">
        {/* Busy is aria-disabled (and the picker does not open), not disabled: a disabled field drops keyboard focus. */}
        <label className={`${styles.smallButton} ${styles.smallButtonQuiet} cursor-pointer`} aria-disabled={busy}>
          <Camera size={16} aria-hidden="true" />{busy ? "Saving…" : "Change photo"}
          <input ref={input} id="explore-avatar-input" type="file" accept="image/*" className="sr-only" aria-disabled={busy || undefined}
            onClick={(event) => { if (busy) event.preventDefault(); }}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void change(file); }} />
        </label>
        {profile.avatar_path && <button type="button" className={`${styles.smallButton} ${styles.smallButtonQuiet}`} aria-disabled={busy || undefined} onClick={() => void clear()}><Trash2 size={16} aria-hidden="true" />Remove</button>}
      </div>
    </div>
  );
}

function Notifications() {
  const { db } = useReadyExplore();
  const prefs = useAsync(() => socialApi.notificationPrefs(db), [db]);
  async function toggle(key: keyof NotificationPrefs, value: boolean) {
    if (!prefs.data) return;
    const before = prefs.data;
    prefs.setData({ ...before, [key]: value });
    try {
      prefs.setData(await socialApi.saveNotificationPrefs(db, { ...before, [key]: value }));
    } catch (error) {
      prefs.setData(before);
      toast.error(toSocialError(error).message);
    }
  }
  return (
    <section className={styles.panel} aria-labelledby="settings-notifications">
      <h2 id="settings-notifications" className={styles.panelTitle}>Notifications</h2>
      {prefs.status === "loading" && <p className={styles.note}>Loading</p>}
      {prefs.status === "error" && <p className={styles.alert} role="alert">{prefs.error}</p>}
      {prefs.data && PREFS.filter((item) => item.shown && typeof prefs.data![item.key] === "boolean").map((item) => (
        <SwitchRow key={item.key} id={`pref-${item.key}`} label={item.label} checked={prefs.data![item.key] === true} onChange={(value) => void toggle(item.key, value)} />
      ))}
    </section>
  );
}

/** Who can start a conversation lives with the messages; this points there (it opens that setting at once). */
function MessagesLink() {
  return (
    <section className={styles.panel} aria-labelledby="settings-messages">
      <h2 id="settings-messages" className={styles.panelTitle}>Messages</h2>
      <p className={styles.note}>Choose who can start a conversation with you. Message requests wait in Messages until you answer them.</p>
      <Link href="/explore/messages?settings=1" className="fitx-button fitx-button-secondary mt-3 inline-flex min-h-11 items-center px-5 text-sm">
        Who can message you
      </Link>
    </section>
  );
}

const safetyRow = (kind: "blocked" | "restricted", id: string) => `safety-${kind}-${id}`;

function Safety() {
  const { db } = useReadyExplore();
  const lists = useAsync(() => socialApi.safetyLists(db), [db]);
  const [busy, setBusy] = useState<string | null>(null);
  const { notice, show } = useNotice();
  const focusAfter = useFocusAfterRender();
  async function undo(kind: "blocked" | "restricted", user: SocialAuthor) {
    if (busy) return;
    const order = lists.data ? [...lists.data.blocked.map((item) => safetyRow("blocked", item.id)), ...lists.data.restricted.map((item) => safetyRow("restricted", item.id))] : [];
    setBusy(safetyRow(kind, user.id));
    try {
      if (kind === "blocked") await socialApi.setBlock(db, user.id, false);
      else await socialApi.setRestrict(db, user.id, false);
      await lists.reload();
      // The row goes: say so beside the list (Unblock used to say nothing), and move focus to the next row, or to the
      // heading once the list is empty (it used to fall to the page body, bug 82).
      show("success", kind === "blocked" ? `@${user.username} is unblocked` : `Restriction on @${user.username} removed`);
      focusAfter(focusAfterRemoval(order, [safetyRow(kind, user.id)]), () => document.getElementById("settings-safety"));
    } catch (error) {
      show("error", toSocialError(error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className={styles.panel} aria-labelledby="settings-safety">
      <h2 id="settings-safety" tabIndex={-1} className={styles.panelTitle}>Blocked and restricted</h2>
      {lists.status === "loading" && <p className={styles.note}>Loading</p>}
      {lists.data && !lists.data.blocked.length && !lists.data.restricted.length && <p className={styles.note}>You have not blocked or restricted anyone.</p>}
      {lists.data && (["blocked", "restricted"] as const).map((kind) => lists.data![kind].length > 0 && (
        <div key={kind} className="mt-2">
          <h3 className={styles.hint}>{kind === "blocked" ? "Blocked" : "Restricted"}</h3>
          <ul className={styles.rowList}>
            {lists.data![kind].map((user) => (
              <li key={user.id} className={styles.rowItem}>
                <Avatar user={user} size={36} />
                <span className={`${styles.whoText} flex-1`}><span className={styles.whoName}>{user.username}</span></span>
                <button type="button" id={safetyRow(kind, user.id)} className={`${styles.smallButton} ${styles.smallButtonQuiet}`} aria-disabled={busy === safetyRow(kind, user.id) || undefined} onClick={() => void undo(kind, user)} aria-label={`${kind === "blocked" ? "Unblock" : "Remove restriction on"} @${user.username}`}>
                  {kind === "blocked" ? "Unblock" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p role="status" className={notice && notice.tone !== "error" ? `${styles.note} mt-3` : "sr-only"}>{notice && notice.tone !== "error" ? notice.text : null}</p>
      {notice?.tone === "error" && <p key={notice.id} role="alert" className={`${styles.alert} mt-3`}>{notice.text}</p>}
    </section>
  );
}

/** "23 Nov 2026". */
function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Removes files from the social-media bucket in batches (Storage takes up to 1,000 a call). */
async function removeFiles(paths: readonly string[]) {
  const storage = createClient()?.storage;
  if (!storage || !paths.length) return;
  for (let start = 0; start < paths.length; start += 100) {
    const batch = paths.slice(start, start + 100);
    await storage.from(SOCIAL_BUCKET).remove(batch).catch(() => undefined);
    forgetPhotoUrls(batch);
  }
}

/**
 * "Add your date of birth": for members FITX has no date of birth for (they get the teen rules until they add one).
 * Saved once; a change later is a support request. Teens read plainly why some parts are closed.
 */
function BirthDate() {
  const { db, me, refresh } = useReadyExplore();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const focusAfter = useFocusAfterRender();
  const band = me.age_band;
  if (band !== "unknown" && band !== "teen") return null;
  if (band === "teen") {
    return (
      <section className={styles.panel} aria-labelledby="settings-age">
        <h2 id="settings-age" tabIndex={-1} className={styles.panelTitle}>Age</h2>
        <p className={styles.note}>Messages, communities and leaderboards are for members aged {SOCIAL_LIMITS.adultAge} and over. Everything else in Explore works as usual.</p>
      </section>
    );
  }
  const age = value ? ageOn(value) : null;
  const problem = !value ? null : age === null || age > 120 || age < 0 ? "Check the date." : age < SOCIAL_LIMITS.minimumAge ? `Explore is for members aged ${SOCIAL_LIMITS.minimumAge} and over.` : null;
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await socialApi.setBirthDate(db, value);
      toast.success(next === "adult" ? "Date of birth saved" : `Date of birth saved. Messages, communities and leaderboards open at ${SOCIAL_LIMITS.adultAge}.`);
      await refresh();
      // This form goes once the date is saved: focus the Age section that replaces it (a teen), or the next section.
      focusAfter("settings-age", () => document.getElementById("settings-content") ?? document.getElementById("settings-safety"));
    } catch (error) {
      toast.error(toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="birth-date" className={styles.panel} aria-labelledby="settings-birth-date">
      <h2 id="settings-birth-date" className={styles.panelTitle}>Date of birth</h2>
      <p className={`${styles.note} mb-3`}>
        Some parts of Explore are for members aged {SOCIAL_LIMITS.adultAge} and over, and FITX has no date of birth for you. It is never shown on your profile.
      </p>
      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (!problem && value) void save(); }}>
        <label className="flex flex-col gap-1.5">
          <span className={styles.hint}>Date of birth</span>
          <input type="date" className={styles.dateField} value={value} max={new Date().toISOString().slice(0, 10)} min="1900-01-01" onChange={(event) => setValue(event.target.value)} aria-describedby="birth-date-hint" required />
        </label>
        <p id="birth-date-hint" className={problem ? styles.hintBad : styles.hint} aria-live="polite">{problem ?? "You can add it once. To change it later, ask FITX support."}</p>
        <div><button type="submit" className={styles.smallButton} disabled={!value || Boolean(problem)} aria-disabled={busy || undefined}>Add your date of birth</button></div>
      </form>
    </section>
  );
}

type Pending = { kind: "post" | "story"; id: string; label: string } | { kind: "all" } | null;
const contentRow = (kind: "post" | "story", id: string) => `content-${kind}-${id}`;

/** "Your Explore content": the member's posts, videos and stories, each with Delete, and "Delete all my Explore content". */
function YourContent() {
  const { db } = useReadyExplore();
  // Before 20261124100000 is applied the list does not exist yet: the section stays out of the way.
  const content = useAsync<MyContent | null>(() => socialApi.myContent(db).catch((error: unknown) => {
    if (toSocialError(error).key === "unavailable") return null;
    throw error;
  }), [db]);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const confirmNotice = useNotice();
  const focusAfter = useFocusAfterRender();
  const heading = useRef<HTMLHeadingElement>(null);
  const data = content.data;
  const total = data ? data.counts.posts + data.counts.stories + data.counts.comments : 0;

  async function confirm() {
    if (!pending || busy) return;
    const order = data ? [...data.posts.map((post) => contentRow("post", post.id)), ...data.stories.map((story) => contentRow("story", story.id))] : [];
    setBusy(true);
    confirmNotice.clear();
    try {
      const paths = pending.kind === "post" ? await socialApi.deletePost(db, pending.id)
        : pending.kind === "story" ? await socialApi.deleteStory(db, pending.id)
          : await socialApi.deleteAllContent(db);
      await removeFiles(paths);
      setPending(null);
      toast.success(pending.kind === "all" ? "Your Explore content is deleted" : pending.kind === "story" ? "Story deleted" : "Post deleted");
      await content.reload();
      // The Delete pressed (and, for everything, "Delete all") has gone: focus the next Delete, or the heading (bug 82).
      focusAfter(pending.kind === "all" ? null : focusAfterRemoval(order, [contentRow(pending.kind, pending.id)]), () => heading.current);
    } catch (error) {
      // Said inside the open confirmation: a toast would be under it (D6).
      confirmNotice.show("error", toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }
  const closeConfirm = () => { setPending(null); confirmNotice.clear(); };

  if (content.status === "ready" && !data) return null;
  return (
    <section className={styles.panel} aria-labelledby="settings-content">
      <h2 id="settings-content" ref={heading} tabIndex={-1} className={styles.panelTitle}>Your Explore content</h2>
      {content.status === "loading" && <p className={styles.note}>Loading</p>}
      {content.status === "error" && <p className={styles.alert} role="alert">{content.error}</p>}
      {data && total === 0 && <p className={styles.note}>You have no posts, stories or comments in Explore.</p>}
      {data && data.posts.length > 0 && (
        <ul className={styles.rowList} aria-label="Your posts">
          {data.posts.map((post) => {
            const label = post.caption.trim() || (post.kind === "video" ? "Video" : post.kind === "text" ? "Discussion" : plural(post.media_count, "photo"));
            return (
              <li key={post.id} className={styles.rowItem}>
                <span className={styles.contentThumb} aria-hidden="true">
                  {post.thumb ? <SocialPhoto path={post.thumb} alt="" ratio={1} /> : null}
                </span>
                <span className={styles.contentText}>
                  <span className={styles.contentTitle}>{label}</span>
                  <span className={styles.contentMeta}>
                    {post.kind === "video" ? "Video" : post.kind === "text" ? "Discussion" : "Photo post"} · <time dateTime={post.created_at} title={fullDate(post.created_at)}>{shortDate(post.created_at)}</time>
                    {post.moderation === "hidden" ? " · Hidden by FITX" : post.moderation === "limited" ? " · Limited by FITX" : ""}
                  </span>
                </span>
                <button type="button" id={contentRow("post", post.id)} className={`${styles.smallButton} ${styles.smallButtonQuiet}`} onClick={() => setPending({ kind: "post", id: post.id, label })} aria-label={`Delete post: ${label}`}>
                  <Trash2 size={16} aria-hidden="true" /><span className={styles.deleteLabel}>Delete</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {data && data.stories.length > 0 && (
        <ul className={`${styles.rowList} mt-2`} aria-label="Your stories">
          {data.stories.map((story) => {
            const label = story.caption.trim() || (story.kind === "video" ? "Video story" : "Photo story");
            return (
              <li key={story.id} className={styles.rowItem}>
                <span className={styles.contentThumb} aria-hidden="true">
                  {story.poster_path || story.kind === "image" ? <SocialPhoto path={story.poster_path ?? story.path} alt="" ratio={1} />
                    : <Clapperboard size={18} className="m-auto mt-4" />}
                </span>
                <span className={styles.contentText}>
                  <span className={styles.contentTitle}><Sparkles size={13} aria-hidden="true" className="mr-1 inline" />{label}</span>
                  <span className={styles.contentMeta}>{story.live ? `Live until ${new Date(story.expires_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Ended"}{story.moderation === "hidden" ? " · Hidden by FITX" : ""}</span>
                </span>
                <button type="button" id={contentRow("story", story.id)} className={`${styles.smallButton} ${styles.smallButtonQuiet}`} onClick={() => setPending({ kind: "story", id: story.id, label })} aria-label={`Delete story: ${label}`}>
                  <Trash2 size={16} aria-hidden="true" /><span className={styles.deleteLabel}>Delete</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {data && total > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className={styles.note}>
            {[
              data.counts.posts ? plural(data.counts.posts, "post") : null,
              data.counts.stories ? plural(data.counts.stories, "story", "stories") : null,
              data.counts.comments ? plural(data.counts.comments, "comment") : null,
            ].filter(Boolean).join(", ")}. Your profile, follows and settings stay.
          </p>
          <div><button type="button" className={styles.dangerButton} onClick={() => setPending({ kind: "all" })}><Trash2 size={16} aria-hidden="true" />Delete all my Explore content</button></div>
        </div>
      )}
      <Sheet
        open={pending !== null}
        onClose={closeConfirm}
        side="center"
        title={pending?.kind === "all" ? "Delete all your Explore content?" : pending?.kind === "story" ? "Delete this story?" : "Delete this post?"}
        description={pending?.kind === "all"
          ? "Every post, video, story and comment you made in Explore is deleted, with their likes and comments. This cannot be undone."
          : "Its files, likes and comments are deleted too. This cannot be undone."}
        notice={confirmNotice.notice}
        footer={
          <div className="flex gap-2">
            <button type="button" className="fitx-button fitx-button-secondary flex-1" onClick={closeConfirm}>Cancel</button>
            <button type="button" className="fitx-button fitx-button-danger flex-1 aria-disabled:opacity-60" aria-disabled={busy || undefined} onClick={() => void confirm()}>
              {pending?.kind === "all" ? "Delete everything" : "Delete"}
            </button>
          </div>
        }
      >
        <span />
      </Sheet>
    </section>
  );
}
