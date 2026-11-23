"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { avatarPath, SOCIAL_BUCKET, socialApi, toSocialError, type NotificationPrefs } from "@/lib/social";
import { compressPhoto } from "@/lib/social/compress";
import { forgetPhotoUrls } from "@/lib/social/media-urls";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./Avatar";
import { useReadyExplore } from "./ExploreContext";
import { ProfileForm } from "./ProfileForm";
import { SwitchRow } from "./Switch";
import { useAsync } from "./useAsync";
import styles from "./Explore.module.css";

const PREFS: { key: keyof NotificationPrefs; label: string }[] = [
  { key: "follows", label: "New followers" },
  { key: "follow_requests", label: "Follow requests" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments and replies" },
  { key: "mentions", label: "Mentions" },
];

/** Explore settings: profile and picture, privacy, comment default, notifications, blocked and restricted accounts. */
export function SettingsView() {
  const { db, profile, me, setMe } = useReadyExplore();
  return (
    <div className={`${styles.narrow} flex flex-col gap-6`}>
      <PageHeader title="Explore settings" />
      <section className={styles.panel} aria-labelledby="settings-profile">
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
      </section>
      <Notifications />
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
  async function change(file: File) {
    const storage = createClient()?.storage;
    if (!storage) return;
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
    const storage = createClient()?.storage;
    setBusy(true);
    try {
      const old = await socialApi.setAvatar(db, null);
      if (old && storage) {
        await storage.from(SOCIAL_BUCKET).remove([old]);
        forgetPhotoUrls([old]);
      }
      setMe({ ...me, profile: { ...profile, avatar_path: null } });
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
        <label className={`${styles.smallButton} ${styles.smallButtonQuiet} cursor-pointer`} aria-disabled={busy}>
          <Camera size={16} aria-hidden="true" />{busy ? "Saving…" : "Change photo"}
          <input ref={input} type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void change(file); }} />
        </label>
        {profile.avatar_path && <button type="button" className={`${styles.smallButton} ${styles.smallButtonQuiet}`} disabled={busy} onClick={() => void clear()}><Trash2 size={16} aria-hidden="true" />Remove</button>}
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
      {prefs.data && PREFS.map((item) => (
        <SwitchRow key={item.key} id={`pref-${item.key}`} label={item.label} checked={prefs.data![item.key]} onChange={(value) => void toggle(item.key, value)} />
      ))}
    </section>
  );
}

function Safety() {
  const { db } = useReadyExplore();
  const lists = useAsync(() => socialApi.safetyLists(db), [db]);
  async function undo(kind: "blocked" | "restricted", id: string) {
    try {
      if (kind === "blocked") await socialApi.setBlock(db, id, false);
      else await socialApi.setRestrict(db, id, false);
      await lists.reload();
    } catch (error) {
      toast.error(toSocialError(error).message);
    }
  }
  return (
    <section className={styles.panel} aria-labelledby="settings-safety">
      <h2 id="settings-safety" className={styles.panelTitle}>Blocked and restricted</h2>
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
                <button type="button" className={`${styles.smallButton} ${styles.smallButtonQuiet}`} onClick={() => void undo(kind, user.id)} aria-label={`${kind === "blocked" ? "Unblock" : "Remove restriction on"} @${user.username}`}>
                  {kind === "blocked" ? "Unblock" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
