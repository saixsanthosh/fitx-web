"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock, ShieldCheck, Trophy, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Reveal } from "@/components/motion/Reveal";
import { Sheet } from "@/components/ui/Sheet";
import { nextCursor, toSocialError, type Cursor, type SocialPost } from "@/lib/social";
import { GROUP_LIMITS } from "@/lib/social/group-limits";
import { formatValue, timeLeftText, type ChallengeMetric } from "@/lib/social/challenges";
import { communitiesApi, joinLabel, memberCountText, REMOVE_REASONS, type CommunityPage } from "@/lib/social/communities";
import { focusAfterRemoval } from "@/lib/social/focus";
import { AgeNotice } from "../AgeNotice";
import { Avatar } from "../Avatar";
import { useReadyExplore } from "../ExploreContext";
import { PostCard } from "../PostCard";
import { SocialPhoto } from "../SocialPhoto";
import { useFocusAfterRender } from "../useFocusAfterRender";
import { useNotice } from "../useNotice";
import { usePaged, useSentinel } from "../usePaged";
import { GroupComposer } from "./GroupComposer";
import styles from "./Community.module.css";
import exploreStyles from "../Explore.module.css";

/** /explore/c/[slug]: one community: join or ask to join, its discussions and posts, its challenges, and moderation. */
export function CommunityView({ slug }: { slug: string }) {
  const { db, me } = useReadyExplore();
  const adult = me.age_band === undefined || me.age_band === "adult";
  const [page, setPage] = useState<CommunityPage | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPage(await communitiesApi.get(db, slug));
      setError(null);
    } catch (failure) {
      setError(toSocialError(failure).message);
    }
  }, [db, slug]);
  useEffect(() => {
    if (!adult) return;
    const start = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(start);
  }, [adult, load]);

  if (!adult) {
    return <div className={styles.column}><AgeNotice band={me.age_band} feature="Joining communities" /></div>;
  }
  if (error && page === undefined) {
    return (
      <div className={`${styles.column} ${exploreStyles.empty}`} role="alert">
        <p className={exploreStyles.emptyText}>{error}</p>
        <button type="button" className="fitx-button fitx-button-secondary" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (page === undefined) return <div className={`${exploreStyles.skeleton} ${styles.column}`} style={{ height: 300 }} aria-busy="true" aria-label="Loading community" />;
  if (page === null) {
    return (
      <div className={`${styles.column} ${exploreStyles.empty}`}>
        <h1 className={exploreStyles.emptyTitle}>Community not available</h1>
        <p className={exploreStyles.emptyText}>It may have closed, or its address changed.</p>
        <Link href="/explore/community" className="fitx-button fitx-button-secondary">All communities</Link>
      </div>
    );
  }

  const { community } = page;
  const action = joinLabel(community);

  async function act() {
    if (busy) return;
    setBusy(true);
    try {
      if (action.action === "join") {
        const result = await communitiesApi.join(db, community.id);
        toast.success(result.status === "accepted" ? `Welcome to ${community.name}` : "Request sent to the moderators");
      } else {
        await communitiesApi.leave(db, community.id);
        toast.success(action.action === "leave" ? `You left ${community.name}` : "Request withdrawn");
      }
      await load();
    } catch (failure) {
      toast.error(toSocialError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="community-title">
        {community.cover_path && <span className={styles.heroCover} aria-hidden="true"><SocialPhoto path={community.cover_path} alt="" ratio={21 / 9} priority /></span>}
        {!community.cover_path && <span className={styles.glow} aria-hidden="true" style={{ width: "48%", inset: "auto -10% -50% auto" }} />}
        <span className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroInner}>
          <p className={styles.cardMeta}>
            {community.visibility === "private" ? <span className={styles.pill}><Lock size={11} aria-hidden="true" />Private</span> : <span className={styles.pill}>Public</span>}
            <span>{memberCountText(community.member_count)}</span>
          </p>
          <h1 id="community-title" className={styles.heroTitle}>{community.name}</h1>
          {community.description && <p className={styles.heroText}>{community.description}</p>}
          <div className={styles.heroActions}>
            <button type="button" className={`${styles.stageButton} ${action.action === "join" ? "" : styles.stageQuiet}`} aria-disabled={busy || undefined} onClick={() => void act()}>
              {busy && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{action.label}
            </button>
            {page.moderators.length > 0 && (
              <span className={styles.faces} aria-label={`Moderators: ${page.moderators.map((m) => `@${m.username}`).join(", ")}`}>
                {page.moderators.slice(0, 4).map((moderator) => <Avatar key={moderator.id} user={moderator} size={30} ring />)}
              </span>
            )}
          </div>
          {community.my_status === "pending" && <p className={styles.heroText}>Your request is with the moderators.</p>}
        </div>
      </section>

      <div className={styles.split}>
        <div className="flex min-w-0 flex-col gap-5">
          {page.can_see_posts && <PostsSection page={page} />}
          {!page.can_see_posts && (
            <div className={exploreStyles.lock}>
              <span className={exploreStyles.emptyMark}><Lock size={24} aria-hidden="true" /></span>
              <h2 className={exploreStyles.emptyTitle}>Members only</h2>
              <p className={exploreStyles.emptyText}>Posts in {community.name} are for its members. Ask to join and a moderator will answer.</p>
            </div>
          )}
        </div>
        <aside id="community-about" tabIndex={-1} className={styles.aside} aria-label="About this community">
          {page.is_moderator && <Requests page={page} onChange={load} />}
          {page.challenges.length > 0 && (
            <section className={exploreStyles.panel} aria-labelledby="community-challenge-title">
              <h2 id="community-challenge-title" className={exploreStyles.panelTitle}>Challenges</h2>
              <ul className="flex flex-col gap-2">
                {page.challenges.map((challenge) => (
                  <li key={challenge.id}>
                    <Link href={`/explore/challenges/${challenge.id}`} className={styles.challengeRow}>
                      <span className={styles.challengeIcon}><Trophy size={18} aria-hidden="true" /></span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[15px] font-semibold">{challenge.title}</span>
                        <span className="text-xs text-fitx-text-secondary">
                          {challenge.target ? `${formatValue(challenge.metric as ChallengeMetric, Number(challenge.target))} · ` : ""}{timeLeftText({ ...challenge, closed_at: null })}{challenge.joined ? " · Joined" : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {page.moderators.length > 0 && (
            <section className={exploreStyles.panel} aria-labelledby="community-mods-title">
              <h2 id="community-mods-title" className={exploreStyles.panelTitle}>Moderators</h2>
              <ul className={exploreStyles.rowList}>
                {page.moderators.map((moderator) => (
                  <li key={moderator.id}>
                    <Link href={`/explore/u/${moderator.username}`} className={exploreStyles.rowItem}>
                      <Avatar user={moderator} size={36} />
                      <span className={exploreStyles.whoText}><span className={exploreStyles.whoName}>{moderator.display_name}</span><span className={exploreStyles.reason}>@{moderator.username}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className={exploreStyles.note}><ShieldCheck size={14} aria-hidden="true" className="mr-1 inline" />Communities are run by FITX. Posts here are seen by {community.visibility === "private" ? "members only" : "anyone on Explore aged 18 or over"}.</p>
        </aside>
      </div>
    </div>
  );
}

function PostsSection({ page }: { page: CommunityPage }) {
  const { db, userId } = useReadyExplore();
  const { community } = page;
  const posts = usePaged<SocialPost, NonNullable<Cursor>>(`community:${community.id}`, async (cursor) => {
    const items = await communitiesApi.posts(db, community.id, cursor);
    return { items, next: nextCursor(items, GROUP_LIMITS.communityPostsPage) };
  });
  const sentinel = useSentinel(posts.more, !posts.done && posts.status === "ready");
  const [removing, setRemoving] = useState<SocialPost | null>(null);
  const [reason, setReason] = useState(REMOVE_REASONS[0].value);
  const [busy, setBusy] = useState(false);
  const removeNotice = useNotice();

  async function remove() {
    if (!removing || busy) return;
    setBusy(true);
    removeNotice.clear();
    try {
      await communitiesApi.moderatorRemove(db, removing.id, reason);
      posts.remove(removing.id);
      setRemoving(null);
      toast.success("Post removed from the community");
    } catch (failure) {
      // Said inside the open sheet: a toast would be under it (D6).
      removeNotice.show("error", toSocialError(failure).message);
    } finally {
      setBusy(false);
    }
  }
  const closeRemove = () => { setRemoving(null); removeNotice.clear(); };

  return (
    <section className="flex flex-col gap-5" aria-labelledby="community-posts-title">
      <h2 id="community-posts-title" className="sr-only">Posts and discussions</h2>
      {page.can_post && (
        <GroupComposer
          communityId={community.id}
          label="Start a discussion"
          placeholder={`Share with ${community.name}`}
          submitLabel="Post"
          onPosted={() => { toast.success("Posted"); posts.reload(); }}
        />
      )}
      {posts.status === "loading" && <div className={exploreStyles.skeleton} style={{ height: 240 }} aria-hidden="true" />}
      {posts.status === "error" && !posts.items.length && <p className={exploreStyles.alert} role="alert">{posts.error}</p>}
      {posts.status === "ready" && !posts.items.length && (
        <div className={exploreStyles.empty}>
          <span className={exploreStyles.emptyMark}><UsersRound size={26} aria-hidden="true" /></span>
          <h3 className={exploreStyles.emptyTitle}>No posts yet</h3>
          <p className={exploreStyles.emptyText}>{page.can_post ? "Start the first discussion." : "Join to start the first discussion."}</p>
        </div>
      )}
      {posts.items.map((post, index) => (
        <Reveal key={post.id} y={14} amount={0.08}>
          <PostCard db={db} post={post} priority={index < 2} onChange={posts.replace} onRemove={posts.remove} />
          {page.is_moderator && post.author.id !== userId && (
            <div className={styles.modBar}>
              <button type="button" className={styles.modButton} onClick={() => setRemoving(post)}>Remove from community</button>
            </div>
          )}
        </Reveal>
      ))}
      <div ref={sentinel} className={exploreStyles.sentinel} aria-hidden="true" />

      <Sheet
        open={removing !== null}
        onClose={closeRemove}
        title="Remove this post?"
        description={`Only its author will still see it. They are told the moderators of ${community.name} removed it, not who.`}
        notice={removeNotice.notice}
        footer={
          <div className="flex gap-2">
            <button type="button" className="fitx-button fitx-button-secondary flex-1" onClick={closeRemove}>Cancel</button>
            <button type="button" className="fitx-button fitx-button-danger flex-1 aria-disabled:opacity-60" aria-disabled={busy || undefined} onClick={() => void remove()}>Remove</button>
          </div>
        }
      >
        <fieldset className={exploreStyles.radioList}>
          <legend className={`${exploreStyles.label} mb-2`}>Why</legend>
          {REMOVE_REASONS.map((option) => (
            <label key={option.value} className={exploreStyles.menuItem}>
              <input type="radio" name="remove-reason" value={option.value} checked={reason === option.value} onChange={() => setReason(option.value)} className="accent-fitx-primary" />
              {option.label}
            </label>
          ))}
        </fieldset>
      </Sheet>
    </section>
  );
}

const joinAcceptId = (userId: string) => `join-accept-${userId}`;

function Requests({ page, onChange }: { page: CommunityPage; onChange: () => Promise<void> }) {
  const { db } = useReadyExplore();
  const [busy, setBusy] = useState<string | null>(null);
  const focusAfter = useFocusAfterRender();
  if (!page.requests.length) return null;
  async function answer(userId: string, username: string, accept: boolean) {
    if (busy) return;
    const order = page.requests.map(({ user }) => joinAcceptId(user.id));
    setBusy(userId);
    try {
      await communitiesApi.answer(db, page.community.id, userId, accept);
      toast.success(accept ? `@${username} joined` : "Request declined");
      await onChange();
      // The answered row goes: focus the next request's Accept (or the one before), else this column (bug 82's rule).
      focusAfter(focusAfterRemoval(order, [joinAcceptId(userId)]), () => document.getElementById("community-about"));
    } catch (failure) {
      toast.error(toSocialError(failure).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className={exploreStyles.panel} aria-labelledby="community-requests-title">
      <h2 id="community-requests-title" className={exploreStyles.panelTitle}>Requests to join</h2>
      <ul className={exploreStyles.rowList}>
        {page.requests.map(({ user }) => (
          <li key={user.id} className={exploreStyles.rowItem}>
            <Link href={`/explore/u/${user.username}`} className={`${exploreStyles.who} min-w-0`}>
              <Avatar user={user} size={36} />
              <span className={exploreStyles.whoText}><span className={exploreStyles.whoName}>{user.username}</span></span>
            </Link>
            <button type="button" id={joinAcceptId(user.id)} className={exploreStyles.smallButton} aria-disabled={busy === user.id || undefined} onClick={() => void answer(user.id, user.username, true)} aria-label={`Accept @${user.username}`}>Accept</button>
            <button type="button" className={`${exploreStyles.smallButton} ${exploreStyles.smallButtonQuiet}`} aria-disabled={busy === user.id || undefined} onClick={() => void answer(user.id, user.username, false)} aria-label={`Decline @${user.username}`}>Decline</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
