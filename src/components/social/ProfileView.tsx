"use client";

import Link from "next/link";
import { useState } from "react";
import { Camera, Flag, ImagePlus, Lock, MoreHorizontal, Settings2, ShieldOff, UserMinus, UserX } from "lucide-react";
import { toast } from "sonner";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { compactCount, nextCursor, socialApi, toSocialError, type Cursor, type FollowListEntry, type ProfilePage, type SocialPost } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import { Avatar } from "./Avatar";
import { useReadyExplore } from "./ExploreContext";
import { PROFILE_ACTIONS } from "@/lib/social/slots";
import { FollowButton } from "./FollowButton";
import { PostGrid } from "./PostGrid";
import { ReportSheet } from "./ReportSheet";
import { useAsync } from "./useAsync";
import { usePaged, useSentinel } from "./usePaged";
import styles from "./Explore.module.css";

/** An account's page: picture, name, counts, bio, follow and safety controls, and its posts when the member may see them. */
export function ProfileView({ username }: { username: string }) {
  const { db } = useReadyExplore();
  const page = useAsync(() => socialApi.profile(db, username), [db, username]);
  if (page.status === "loading") return <div className={styles.skeleton} style={{ height: 420 }} aria-busy="true" aria-label="Loading profile" />;
  if (page.status === "error") return <p className={styles.alert} role="alert">{page.error}</p>;
  if (!page.data) {
    return (
      <div className={`${styles.empty} ${styles.narrow}`}>
        <h1 className={styles.emptyTitle}>Account not found</h1>
        <p className={styles.emptyText}>The username may have changed.</p>
        <Link href="/explore/discover" className="fitx-button fitx-button-secondary">Search Explore</Link>
      </div>
    );
  }
  return <Profile key={page.data.profile.id} db={db} page={page.data} reload={page.reload} />;
}

function Profile({ db, page, reload }: { db: Db; page: ProfilePage; reload: () => Promise<void> }) {
  const { profile, counts, relation } = page;
  const ProfileActions = PROFILE_ACTIONS;
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<"block" | "remove" | null>(null);
  const [report, setReport] = useState(false);
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await run();
      toast.success(done);
      setMenu(false);
      setConfirm(null);
      await reload();
    } catch (error) {
      toast.error(toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-5">
        <div className={styles.profileHead}>
          <Avatar user={profile} size={96} ring={!relation.is_self && relation.following === "accepted"} />
          <div className="min-w-0">
            <h1 className={styles.profileName}>{profile.display_name}</h1>
            <p className={styles.profileUser}>
              @{profile.username}
              {profile.is_private && <Lock size={13} className="ml-1.5 inline align-[-1px]" aria-label="Private account" />}
              {relation.follows_you && !relation.is_self && <span className={`${styles.restrictedTag} ml-2`}>Follows you</span>}
            </p>
            <div className={styles.counts}>
              <span className={styles.countButton}><span className={styles.countValue}>{compactCount(counts.posts)}</span><span className={styles.countLabel}>{counts.posts === 1 ? "post" : "posts"}</span></span>
              <button type="button" className={styles.countButton} disabled={!page.can_see_posts} onClick={() => setList("followers")} aria-label={`${counts.followers} followers`}>
                <span className={styles.countValue}>{compactCount(counts.followers)}</span><span className={styles.countLabel}>{counts.followers === 1 ? "follower" : "followers"}</span>
              </button>
              <button type="button" className={styles.countButton} disabled={!page.can_see_posts} onClick={() => setList("following")} aria-label={`${counts.following} following`}>
                <span className={styles.countValue}>{compactCount(counts.following)}</span><span className={styles.countLabel}>following</span>
              </button>
            </div>
          </div>
        </div>
        {profile.bio && <p className={styles.bio}>{profile.bio}</p>}
        <div className={styles.profileActions}>
          {relation.is_self ? (
            <>
              <Link href="/explore/settings" className={`${styles.smallButton} ${styles.smallButtonQuiet}`}><Settings2 size={16} aria-hidden="true" />Edit profile</Link>
              <Link href="/explore/new" className={styles.smallButton}><ImagePlus size={16} aria-hidden="true" />New post</Link>
            </>
          ) : relation.blocked ? (
            <button type="button" className={styles.smallButton} disabled={busy} onClick={() => void act(() => socialApi.setBlock(db, profile.id, false), `@${profile.username} is unblocked`)}>Unblock</button>
          ) : (
            <>
              <FollowButton db={db} userId={profile.id} username={profile.username} state={relation.following} onChange={() => void reload()} />
              {ProfileActions && <ProfileActions userId={profile.id} username={profile.username} />}
            </>
          )}
          {!relation.is_self && (
            <button type="button" className={styles.iconButton} aria-label="Account options" aria-haspopup="dialog" onClick={() => setMenu(true)}><MoreHorizontal size={20} aria-hidden="true" /></button>
          )}
        </div>
      </header>

      {relation.blocked ? (
        <div className={styles.lock}><UserX size={26} aria-hidden="true" /><p className={styles.emptyTitle}>You blocked this account</p><p className={styles.emptyText}>Unblock to see each other again.</p></div>
      ) : page.can_see_posts ? (
        <Posts db={db} userId={profile.id} self={relation.is_self} />
      ) : (
        <div className={styles.lock}>
          <span className={styles.emptyMark}><Lock size={24} aria-hidden="true" /></span>
          <p className={styles.emptyTitle}>This account is private</p>
          <p className={styles.emptyText}>{relation.following === "pending" ? "Your request is waiting for an answer." : "Follow to see their posts."}</p>
        </div>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={`@${profile.username}`}>
        <div className={styles.menu}>
          {relation.follows_you && (
            <button type="button" className={styles.menuItem} onClick={() => { setMenu(false); setConfirm("remove"); }}><UserMinus size={18} aria-hidden="true" />Remove follower</button>
          )}
          <button type="button" className={styles.menuItem} disabled={busy} onClick={() => void act(() => socialApi.setRestrict(db, profile.id, !relation.restricted), relation.restricted ? "Restriction removed" : `@${profile.username} is restricted`)}>
            <ShieldOff size={18} aria-hidden="true" />{relation.restricted ? "Remove restriction" : "Restrict"}
          </button>
          {!relation.restricted && <p className={`${styles.hint} px-3`}>Restricted: their comments on your posts are seen only by them and you, and they send you no notifications.</p>}
          <button type="button" className={styles.menuItem} onClick={() => { setMenu(false); setReport(true); }}><Flag size={18} aria-hidden="true" />Report account</button>
          {!relation.blocked && (
            <button type="button" className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => { setMenu(false); setConfirm("block"); }}><UserX size={18} aria-hidden="true" />Block</button>
          )}
        </div>
      </Sheet>
      <Sheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        side="center"
        title={confirm === "block" ? `Block @${profile.username}?` : `Remove @${profile.username}?`}
        description={confirm === "block"
          ? "Neither of you will see the other’s profile, posts or comments, and any follows between you end. They are not told."
          : "They stop following you. They are not told."}
        footer={
          <div className="flex gap-2">
            <button type="button" className="fitx-button fitx-button-secondary flex-1" onClick={() => setConfirm(null)}>Cancel</button>
            <button
              type="button"
              className="fitx-button fitx-button-danger flex-1"
              disabled={busy}
              onClick={() => void (confirm === "block"
                ? act(() => socialApi.setBlock(db, profile.id, true), `@${profile.username} is blocked`)
                : act(() => socialApi.removeFollower(db, profile.id), "Follower removed"))}
            >
              {confirm === "block" ? "Block" : "Remove"}
            </button>
          </div>
        }
      >
        <span />
      </Sheet>
      <ReportSheet db={db} target={report ? { type: "account", id: profile.id } : null} onClose={() => setReport(false)} />
      <FollowList db={db} userId={profile.id} kind={list} onClose={() => setList(null)} />
    </div>
  );
}

const PAGE = 18;

function Posts({ db, userId, self }: { db: Db; userId: string; self: boolean }) {
  const [tab, setTab] = useState<"posts" | "saved">("posts");
  return (
    <section aria-label={tab === "posts" ? "Posts" : "Saved"} className="flex flex-col gap-4">
      {self && <Segmented label="Show" options={[{ value: "posts", label: "Posts" }, { value: "saved", label: "Saved" }]} value={tab} onChange={setTab} />}
      {tab === "posts" ? <OwnPosts db={db} userId={userId} self={self} /> : <SavedPosts db={db} />}
    </section>
  );
}

function OwnPosts({ db, userId, self }: { db: Db; userId: string; self: boolean }) {
  const posts = usePaged<SocialPost, NonNullable<Cursor>>(`profile:${userId}`, async (cursor) => {
    const items = await socialApi.browse(db, { userId }, cursor, PAGE);
    return { items, next: nextCursor(items, PAGE) };
  });
  const sentinel = useSentinel(posts.more, !posts.done && posts.status === "ready");
  if (posts.status === "loading") return <div className={styles.skeleton} style={{ height: 240 }} aria-hidden="true" />;
  if (posts.status === "error" && !posts.items.length) return <p className={styles.alert} role="alert">{posts.error}</p>;
  if (!posts.items.length) {
    return self ? (
      <div className={styles.empty}>
        <span className={styles.emptyMark}><Camera size={26} aria-hidden="true" /></span>
        <p className={styles.emptyTitle}>Share your first post</p>
        <Link href="/explore/new" className="fitx-button">New post</Link>
      </div>
    ) : <p className={styles.note}>No posts yet.</p>;
  }
  return (
    <>
      <PostGrid posts={posts.items} label="Posts" />
      <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
      {!posts.done && <div className="flex justify-center"><button type="button" className={`${styles.smallButton} ${styles.smallButtonQuiet}`} onClick={posts.more}>Show more</button></div>}
    </>
  );
}

function SavedPosts({ db }: { db: Db }) {
  const saved = usePaged<SocialPost, string>("saved", async (before) => {
    const items = await socialApi.saved(db, before, PAGE);
    return { items, next: items.length < PAGE ? null : items[items.length - 1].saved_at ?? null };
  });
  if (saved.status === "loading") return <div className={styles.skeleton} style={{ height: 240 }} aria-hidden="true" />;
  if (!saved.items.length) return <p className={styles.note}>Posts you save show here. Only you can see them.</p>;
  return (
    <>
      <p className={styles.hint}>Only you can see what you saved.</p>
      <PostGrid posts={saved.items} label="Saved posts" />
      {!saved.done && <div className="flex justify-center"><button type="button" className={`${styles.smallButton} ${styles.smallButtonQuiet}`} onClick={saved.more}>Show more</button></div>}
    </>
  );
}

function FollowList({ db, userId, kind, onClose }: { db: Db; userId: string; kind: "followers" | "following" | null; onClose: () => void }) {
  return (
    <Sheet open={kind !== null} onClose={onClose} title={kind === "following" ? "Following" : "Followers"}>
      {kind && <FollowListBody db={db} userId={userId} kind={kind} />}
    </Sheet>
  );
}

function FollowListBody({ db, userId, kind }: { db: Db; userId: string; kind: "followers" | "following" }) {
  const { userId: me } = useReadyExplore();
  const list = useAsync<FollowListEntry[]>(() => socialApi.followList(db, userId, kind), [db, userId, kind]);
  if (list.status === "loading") return <p className={styles.note}>Loading</p>;
  if (list.status === "error") return <p className={styles.alert} role="alert">{list.error}</p>;
  if (!list.data?.length) return <p className={styles.note}>Nobody yet.</p>;
  return (
    <ul className={styles.rowList}>
      {list.data.map((entry) => (
        <li key={entry.user.id} className={styles.rowItem}>
          <Link href={`/explore/u/${entry.user.username}`} className={`${styles.who} min-w-0`}>
            <Avatar user={entry.user} size={40} />
            <span className={styles.whoText}><span className={styles.whoName}>{entry.user.username}</span><span className={styles.reason}>{entry.user.display_name}</span></span>
          </Link>
          {entry.user.id !== me && <FollowButton db={db} userId={entry.user.id} username={entry.user.username} state={entry.following} compact />}
        </li>
      ))}
    </ul>
  );
}
