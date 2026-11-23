"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Info, Loader2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
import { Reveal } from "@/components/motion/Reveal";
import { fullDate, relativeTime, toSocialError } from "@/lib/social";
import {
  BADGE_TEXT, challengePhase, participantsText, challengesApi, countingNote, formatValue, metricText, ordinal, progressShare, targetText, timeLeftText, windowText,
  type Board, type ChallengePage,
} from "@/lib/social/challenges";
import { AgeNotice } from "../AgeNotice";
import { Avatar } from "../Avatar";
import { useReadyExplore } from "../ExploreContext";
import { PostCard } from "../PostCard";
import { SwitchRow } from "../Switch";
import { GroupComposer } from "../community/GroupComposer";
import { BadgeMark } from "./BadgeMark";
import { METRIC_ICON } from "./ChallengeCard";
import styles from "./Challenges.module.css";
import exploreStyles from "../Explore.module.css";

/** /explore/challenges/[id]: one challenge: join, the member's computed value, the opt-in board, badges and progress shares. */
export function ChallengeView({ id }: { id: string }) {
  const { db, me } = useReadyExplore();
  const [page, setPage] = useState<ChallengePage | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await challengesApi.get(db, id);
      setPage(next);
      setError(null);
      if (next?.board_allowed) setBoard(await challengesApi.board(db, id).catch(() => null));
    } catch (failure) {
      setError(toSocialError(failure).message);
    }
  }, [db, id]);
  useEffect(() => {
    const start = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(start);
  }, [load]);

  if (error && page === undefined) {
    return (
      <div className={`${exploreStyles.narrow} ${exploreStyles.empty}`} role="alert">
        <p className={exploreStyles.emptyText}>{error}</p>
        <button type="button" className="fitx-button fitx-button-secondary" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (page === undefined) return <div className={`${exploreStyles.skeleton} ${exploreStyles.narrow}`} style={{ height: 320 }} aria-busy="true" aria-label="Loading challenge" />;
  if (page === null) {
    return (
      <div className={`${exploreStyles.narrow} ${exploreStyles.empty}`}>
        <h1 className={exploreStyles.emptyTitle}>Challenge not available</h1>
        <p className={exploreStyles.emptyText}>It may belong to a community you are not in.</p>
        <Link href="/explore/challenges" className="fitx-button fitx-button-secondary">All challenges</Link>
      </div>
    );
  }

  const challenge = page;
  const phase = challengePhase(challenge);
  const open = phase === "open" || phase === "upcoming";

  async function run(work: () => Promise<ChallengePage | boolean>, done: string) {
    setBusy(true);
    try {
      const result = await work();
      if (typeof result === "object" && result) setPage(result);
      toast.success(done);
      await load();
    } catch (failure) {
      toast.error(toSocialError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <Link href="/explore/challenges" className={`${exploreStyles.linkQuiet} inline-flex items-center gap-1`}><ArrowLeft size={15} aria-hidden="true" />Challenges</Link>
      <Hero page={challenge} busy={busy}
        onJoin={() => void run(() => challengesApi.join(db, id), "You joined the challenge")}
        onLeave={() => void run(() => challengesApi.leave(db, id), "You left the challenge")} />

      <div className={styles.layout}>
        <div className="flex min-w-0 flex-col gap-5">
          {challenge.badges.length > 0 && (
            <ul className={styles.badges} aria-label="Your badges">
              {challenge.badges.map((kind) => (
                <li key={kind} className={styles.badge}>
                  <BadgeMark kind={kind} />
                  <span className="flex flex-col"><span className={styles.badgeTitle}>{BADGE_TEXT[kind].title}</span><span className={styles.badgeText}>{BADGE_TEXT[kind].text}</span></span>
                </li>
              ))}
            </ul>
          )}
          {challenge.joined && open && phase === "open" && (
            <GroupComposer
              challengeId={challenge.id}
              label="Share your progress"
              placeholder="How is it going? Your count is added for you."
              submitLabel="Share progress"
              onPosted={() => { toast.success("Progress shared"); void load(); }}
            />
          )}
          <section aria-labelledby="progress-title" className="flex flex-col gap-5">
            <h2 id="progress-title" className={exploreStyles.sectionTitle}>Progress shared</h2>
            {challenge.posts.length === 0 && <p className={exploreStyles.note}>No one has shared progress yet{challenge.joined && phase === "open" ? ". Be the first." : "."}</p>}
            {challenge.posts.map((post) => (
              <Reveal key={post.id} y={14} amount={0.08} className="flex flex-col gap-3">
                {post.entry && (
                  <span className={styles.entryChip}>
                    @{post.author.username} · {formatValue(challenge.metric, Number(post.entry.value))}{post.entry.rank ? ` · ${ordinal(post.entry.rank)}` : ""}
                  </span>
                )}
                <PostCard db={db} post={post} />
              </Reveal>
            ))}
          </section>
        </div>

        <aside className={styles.side} aria-label="Leaderboard and settings">
          {challenge.joined && (
            <section className={exploreStyles.panel} aria-labelledby="board-choice-title">
              <h2 id="board-choice-title" className="sr-only">Leaderboard</h2>
              {challenge.board_allowed ? (
                <SwitchRow
                  id="on-board"
                  label="Show me on the leaderboard"
                  help="Off by default. Others see your name and count, nothing else."
                  checked={challenge.entry?.on_leaderboard === true}
                  disabled={busy || phase === "closed"}
                  onChange={(next) => void run(() => challengesApi.setLeaderboard(db, id, next), next ? "You are on the leaderboard" : "You are off the leaderboard")}
                />
              ) : <AgeNotice band={me.age_band} feature="The leaderboard" />}
            </section>
          )}
          {challenge.board_allowed ? <BoardPanel page={challenge} board={board} /> : !challenge.joined && <AgeNotice band={me.age_band} feature="The leaderboard" />}
          <p className={`${exploreStyles.note} flex gap-2`}><Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" />{countingNote(challenge)}</p>
        </aside>
      </div>
    </div>
  );
}

function Hero({ page, busy, onJoin, onLeave }: { page: ChallengePage; busy: boolean; onJoin: () => void; onLeave: () => void }) {
  const reduced = useReducedMotionSafe();
  const Icon = METRIC_ICON[page.metric];
  const phase = challengePhase(page);
  const target = targetText(page);
  const value = page.entry?.value ?? null;
  const share = progressShare(value, page.target);
  const [drawn, setDrawn] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [reduced]);
  const radius = 74;
  const length = 2 * Math.PI * radius;
  const shown = share ?? 0;

  return (
    <section className={styles.hero} aria-labelledby="challenge-title">
      <Icon size={300} strokeWidth={1} className={styles.heroGlyph} aria-hidden="true" />
      <div className={styles.heroInner}>
        <div className="flex min-w-0 flex-col gap-3">
          <p className={styles.heroMeta}>
            <span className={styles.kind}>{page.kind === "weekly" ? "Weekly" : "Monthly"}</span>
            <span>{timeLeftText(page)}</span>
            {page.community && <Link href={`/explore/c/${page.community.slug}`} className="underline-offset-2 hover:underline">{page.community.name}</Link>}
          </p>
          <h1 id="challenge-title" className={styles.heroTitle}>{page.title}</h1>
          <p className={styles.heroMeta}>
            <span>{metricText(page.metric, page.sport)}</span>
            {target && <span>Goal {target}</span>}
            <span>{windowText(page)}</span>
            <span>{participantsText(page.participants)}</span>
          </p>
          <div className={styles.heroActions}>
            {!page.joined && (phase === "open" || phase === "upcoming") && (
              <button type="button" className={styles.stageButton} disabled={busy} onClick={onJoin}>
                {busy && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Join challenge
              </button>
            )}
            {page.joined && (phase === "open" || phase === "upcoming") && (
              <button type="button" className={`${styles.stageButton} ${styles.stageQuiet}`} disabled={busy} onClick={onLeave}>Leave</button>
            )}
            {!page.joined && phase !== "open" && phase !== "upcoming" && <span className={styles.heroMeta}>This challenge has ended.</span>}
          </div>
        </div>
        {page.entry && (
          <div className={styles.ring} role="img" aria-label={`Your count: ${formatValue(page.metric, Number(page.entry.value))}${target ? ` of ${target}` : ""}${page.entry.rank ? `, ${ordinal(page.entry.rank)} on the leaderboard` : ""}`}>
            <svg viewBox="0 0 168 168" aria-hidden="true">
              <circle className={styles.ringTrack} cx="84" cy="84" r={radius} strokeWidth="10" />
              <circle className={styles.ringFill} cx="84" cy="84" r={radius} strokeWidth="10" strokeDasharray={length}
                strokeDashoffset={drawn ? length * (1 - shown) : length} />
            </svg>
            <span className={styles.ringValue} aria-hidden="true">
              <span className={styles.ringNumber}>{Number(page.entry.value).toLocaleString("en-GB", { maximumFractionDigits: 1 })}</span>
              <span className={styles.ringUnit}>{formatValue(page.metric, Number(page.entry.value)).replace(/^[\d.,]+\s/, "")}{target ? ` of ${target.replace(/\s.*$/, "")}` : ""}</span>
              {page.entry.synced_at && <span className={styles.ringUnit} title={fullDate(page.entry.synced_at)}>Counted {relativeTime(page.entry.synced_at)}{relativeTime(page.entry.synced_at) === "now" ? "" : " ago"}</span>}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function BoardPanel({ page, board }: { page: ChallengePage; board: Board | null }) {
  return (
    <section className={exploreStyles.panel} aria-labelledby="board-title">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="board-title" className={exploreStyles.panelTitle} style={{ marginBottom: 0 }}>Leaderboard</h2>
        {board && board.size > 0 && <span className={exploreStyles.reason}>{board.size === 1 ? "1 member" : `${board.size} members`}</span>}
      </div>
      {!board && <div className={exploreStyles.skeleton} style={{ height: 120 }} aria-hidden="true" />}
      {board && board.size === 0 && (
        <p className={exploreStyles.note}><Trophy size={14} aria-hidden="true" className="mr-1 inline" />No one is on the leaderboard yet. Members choose to show their count here.</p>
      )}
      {board && board.rows.length > 0 && (
        <ol className={styles.board} aria-label="Leaderboard">
          {board.rows.map((row) => (
            <li key={row.user.id} className={`${styles.boardRow} ${row.mine ? styles.boardMine : ""}`}>
              <span className={`${styles.place} ${row.rank <= 3 ? styles.placeTop : ""}`} aria-label={ordinal(row.rank)}>{row.rank}</span>
              <Avatar user={row.user} size={32} />
              <Link href={`/explore/u/${row.user.username}`} className={styles.boardName}>{row.mine ? "You" : row.user.display_name}</Link>
              <span className={styles.boardValue}>{formatValue(page.metric, Number(row.value))}</span>
            </li>
          ))}
        </ol>
      )}
      {board?.me && !board.rows.some((row) => row.mine) && (
        <p className={`${exploreStyles.note} mt-2`}>You are {ordinal(board.me.rank)} with {formatValue(page.metric, Number(board.me.value))}.</p>
      )}
    </section>
  );
}
