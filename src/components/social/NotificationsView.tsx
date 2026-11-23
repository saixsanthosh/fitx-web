"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { fullDate, nextCursor, relativeTime, socialApi, toSocialError, type Cursor, type SocialAuthor, type SocialNotification } from "@/lib/social";
import { notificationHref, notificationText } from "@/lib/social/text";
import { Avatar } from "./Avatar";
import { useReadyExplore } from "./ExploreContext";
import { FollowButton } from "./FollowButton";
import { SocialPhoto } from "./SocialPhoto";
import { useAsync } from "./useAsync";
import { usePaged, useSentinel } from "./usePaged";
import styles from "./Explore.module.css";

const PAGE = 30;


/** Follow requests to answer, then likes, comments, replies, mentions and follows, newest first. */
export function NotificationsView() {
  const { db, userId, refresh, profile } = useReadyExplore();
  const requests = useAsync(() => socialApi.requests(db), [db]);
  const list = usePaged<SocialNotification, NonNullable<Cursor>>(`notes:${userId}`, async (cursor) => {
    const items = await socialApi.notifications(db, cursor, PAGE);
    return { items, next: nextCursor(items, PAGE) };
  });
  const sentinel = useSentinel(list.more, !list.done && list.status === "ready");
  // Waiting requests are answered in their own section above, so the list leaves them out.
  const notes = list.items.filter((note) => note.type !== "follow_request");
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || list.status !== "ready") return;
    marked.current = true;
    void socialApi.markRead(db).then(() => refresh()).catch(() => undefined);
  }, [db, list.status, refresh]);

  return (
    <div className={`${styles.narrow} flex flex-col gap-6`}>
      <PageHeader title="Notifications" />
      {!!requests.data?.length && (
        <section className={styles.panel} aria-labelledby="requests-title">
          <h2 id="requests-title" className={styles.panelTitle}>Follow requests</h2>
          <ul className={styles.rowList}>
            {requests.data.map((request) => (
              <Request key={request.user.id} user={request.user} onDone={() => { void requests.reload(); void refresh(); }} />
            ))}
          </ul>
        </section>
      )}
      {list.status === "loading" && <div className={styles.skeleton} style={{ height: 280 }} aria-hidden="true" />}
      {list.status === "error" && !list.items.length && <p className={styles.alert} role="alert">{list.error}</p>}
      {list.status === "ready" && !notes.length && !requests.data?.length && (
        <div className={styles.empty}>
          <span className={styles.emptyMark}><Bell size={26} aria-hidden="true" /></span>
          <h2 className={styles.emptyTitle}>Nothing new</h2>
          <p className={styles.emptyText}>Likes, comments, mentions and follows show here.</p>
        </div>
      )}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Notifications">
          {notes.map((note) => {
            const href = notificationHref(note, profile.username);
            const text = notificationText(note);
            const actor = note.actor;
            return (
              <li key={note.id} className={`${styles.note_} ${note.read ? "" : styles.noteUnread}`}>
                {actor ? (
                  <Link href={`/explore/u/${actor.username}`} aria-label={actor.display_name}><Avatar user={actor} size={44} /></Link>
                ) : (
                  <span className={styles.fitxMark} aria-hidden="true">FITX</span>
                )}
                <p className={styles.noteText}>
                  {actor && <><Link href={`/explore/u/${actor.username}`} className="font-semibold">{actor.username}</Link>{" "}</>}
                  {href ? <Link href={href}>{text}</Link> : text}{" "}
                  <time className={styles.time} dateTime={note.created_at} title={fullDate(note.created_at)}>{relativeTime(note.created_at)}</time>
                  {!note.read && <span className="sr-only"> (new)</span>}
                </p>
                {note.thumb && href ? (
                  <Link href={href} className={styles.noteThumb} aria-label={note.post_id ? "Open post" : "Open"}><SocialPhoto path={note.thumb} alt="" ratio={1} /></Link>
                ) : actor && (note.type === "follow" || note.type === "follow_accepted") ? (
                  <FollowButton db={db} userId={actor.id} username={actor.username} state={note.following} compact />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
    </div>
  );
}

function Request({ user, onDone }: { user: SocialAuthor; onDone: () => void }) {
  const { db } = useReadyExplore();
  const [busy, setBusy] = useState(false);
  async function answer(accept: boolean) {
    setBusy(true);
    try {
      await socialApi.answerRequest(db, user.id, accept);
      toast.success(accept ? `@${user.username} can now see your posts` : "Request removed");
      onDone();
    } catch (error) {
      toast.error(toSocialError(error).message);
      setBusy(false);
    }
  }
  return (
    <li className={styles.rowItem}>
      <Link href={`/explore/u/${user.username}`} className={`${styles.who} min-w-0`}>
        <Avatar user={user} size={44} />
        <span className={styles.whoText}><span className={styles.whoName}>{user.username}</span><span className={styles.reason}>{user.display_name}</span></span>
      </Link>
      <button type="button" className={styles.smallButton} disabled={busy} onClick={() => void answer(true)} aria-label={`Accept @${user.username}`}>Accept</button>
      <button type="button" className={`${styles.smallButton} ${styles.smallButtonQuiet}`} disabled={busy} onClick={() => void answer(false)} aria-label={`Decline @${user.username}`}>Decline</button>
    </li>
  );
}
