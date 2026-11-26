"use client";

import Image from "next/image";
import Link from "next/link";
import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Play, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { EASE } from "@/components/motion";
import { ACTIVITY_MEDIA, type ActivityMediaId } from "@/data/activity-media";
import { StatRow, StatTile } from "@/components/ui/StatTile";
import { SPORT_LABEL, SPORT_NOUN, sportFamily, usesPace } from "@/lib/activity/config";
import { sportSummary } from "@/lib/activity/feed";
import { focusWitness, handsFocusOn } from "@/lib/activity/focus";
import { durationFigure, paceValue } from "@/lib/activity/format";
import { personalBests } from "@/lib/activity/stats";
import type { Sport } from "@/lib/activity/types";
import { AccountError } from "./AccountError";
import { PersonalBestsPanel } from "./ActivityStats";
import { FeedList } from "./FeedList";
import { recordHref, SPORT_PLURAL, SportIcon, sportHref } from "./sports";
import { useActivityAccount } from "./useActivityAccount";
import { useActivityFeed } from "./useActivityFeed";
import { BestEffortsOverview } from "./BestEfforts";
import { useStoredEfforts } from "./useActivityV2";

/** FITX's own line art per sport: a short loop for walks, a longer out-and-back for runs, a sweeping road for rides. */
const ROUTE_ART: Record<Sport, string> = {
  walk: "M40 150 C 70 92, 128 84, 160 112 S 236 168, 268 120 S 300 54, 248 42 S 150 60, 120 30",
  run: "M24 160 C 64 150, 76 96, 116 92 S 170 128, 204 96 S 232 30, 276 40 S 320 92, 296 132 S 236 168, 200 150",
  ride: "M10 140 C 70 140, 90 60, 150 60 S 220 150, 280 120 S 320 40, 340 30",
  // A switchback climb to a summit.
  hike: "M30 170 C 80 165, 120 150, 90 132 S 120 104, 170 110 S 210 92, 160 76 S 196 46, 250 52 S 300 30, 320 22",
  // A wandering single track.
  trail_run: "M18 150 C 52 168, 86 120, 110 128 S 140 170, 176 140 S 196 80, 236 92 S 268 140, 300 110 S 316 50, 336 40",
  // Short, steep zigzags.
  mtb: "M14 160 C 40 150, 60 120, 88 128 S 112 96, 140 100 S 160 64, 196 74 S 214 40, 252 48 S 290 22, 336 26",
  ebike: "M10 150 C 80 150, 110 90, 170 90 S 240 130, 290 100 S 330 50, 342 36",
  wheelchair: "M30 150 C 90 150, 120 110, 180 112 S 260 140, 300 100 S 320 60, 330 40",
  skate: "M10 120 C 60 60, 110 160, 160 110 S 230 50, 270 100 S 320 150, 342 80",
  // A shoreline crossing.
  paddle: "M14 120 C 60 100, 100 140, 150 118 S 220 90, 260 110 S 310 130, 342 100",
};

/** Each sport's backdrop: an empty place it is done in (AI stills, checked by eye; no people, no invented results). */
const SCENE: Record<Sport, ActivityMediaId> = {
  walk: "promenade", run: "riverside", ride: "open-road", hike: "mountain-trail", trail_run: "mountain-trail", mtb: "forest-singletrack",
  ebike: "open-road", wheelchair: "promenade", skate: "promenade", paddle: "lake",
};

const km = (n: number) => n.toFixed(2);

function Hero({ sport }: { sport: Sport }) {
  return (
    <section className="relative isolate overflow-hidden rounded-3xl bg-fitx-stage text-fitx-on-stage" aria-labelledby="sport-title">
      {/* The photo settles from a slight zoom (transform only); still with reduced motion. */}
      <m.div aria-hidden="true" className="absolute inset-0 -z-10" initial={{ scale: 1.06, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 1.8, ease: EASE.out }}>
        <Image src={ACTIVITY_MEDIA[SCENE[sport]].src} alt="" fill sizes="(min-width: 1024px) 1024px, 100vw" priority placeholder="blur" blurDataURL={ACTIVITY_MEDIA[SCENE[sport]].blurDataURL} className="object-cover" />
      </m.div>
      {/* Keeps the words readable over any photo, in both themes (the stage is dark in both). */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-fitx-stage via-fitx-stage/75 to-fitx-stage/20 sm:bg-gradient-to-r sm:from-fitx-stage sm:via-fitx-stage/70 sm:to-fitx-stage/10" />
      <svg viewBox="0 0 350 190" className="pointer-events-none absolute inset-y-0 right-0 h-full w-[78%] max-w-[560px] opacity-90 sm:w-[60%]" aria-hidden="true" focusable="false" preserveAspectRatio="xMaxYMid meet">
        <path d={ROUTE_ART[sport]} fill="none" stroke="var(--fitx-on-stage)" strokeOpacity="0.12" strokeWidth="10" strokeLinecap="round" />
        <m.path
          d={ROUTE_ART[sport]}
          fill="none"
          stroke="var(--fitx-primary-bright)"
          strokeWidth="3.5"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.6, ease: EASE.inOut, delay: 0.15 }}
        />
      </svg>
      <div className="relative flex min-h-[260px] flex-col justify-between gap-8 p-5 sm:min-h-[300px] sm:p-8">
        <Link href="/activity" className="-ml-2 inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-2 text-sm font-medium text-fitx-on-stage-secondary hover:text-fitx-on-stage">
          <ChevronLeft size={18} aria-hidden="true" />Activity
        </Link>
        <div>
          <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-fitx-on-stage-secondary"><SportIcon sport={sport} size={14} />{SPORT_PLURAL[sport]}</p>
          <h1 id="sport-title" className="font-heading text-[56px] font-bold leading-[.9] tracking-[-.05em] sm:text-[80px]">{SPORT_LABEL[sport]}</h1>
          <Link href={recordHref(sport)} className="fitx-button mt-6 min-h-14 px-7 text-base">
            <Play size={18} aria-hidden="true" />Start {SPORT_NOUN[sport]}
          </Link>
        </div>
      </div>
    </section>
  );
}

/** A sport's own page: its start button, figures that fit it, its bests and its own history. */
export function SportScreen({ sport }: { sport: Sport }) {
  const account = useActivityAccount();
  const userId = account.status === "ready" ? account.userId : null;
  const feed = useActivityFeed(userId, sport);
  const efforts = useStoredEfforts(userId);
  // The figures' Try again: one reload at a time (aria-disabled meanwhile, so focus stays on it; D5). Once the figures
  // load, the alert and its button go, so focus moves to the figures themselves: after a press, and when they came back
  // by themselves (the "online" reload) while Try again had focus. Focus anywhere else stays where it is.
  const [retrying, setRetrying] = useState(false);
  const figuresRef = useRef<HTMLElement | null>(null);
  const refocusFigures = useRef(false);
  const [{ ref: figuresRetryRef, wentWithFocus: figuresRetryWent }] = useState(() => focusWitness<HTMLButtonElement>());
  // The history's heading: where focus goes when what had it in the list went with the list read again (FeedList).
  const historyTitleRef = useRef<HTMLHeadingElement | null>(null);
  const statsStatus = feed.statsStatus;
  useEffect(() => {
    if (retrying) return;
    const pressed = refocusFigures.current;
    refocusFigures.current = false;
    const wentWithFocus = figuresRetryWent();
    if (statsStatus === "ready" && handsFocusOn(document, { pressed, wentWithFocus })) figuresRef.current?.focus();
  }, [retrying, statsStatus, figuresRetryWent]);

  async function retryFigures() {
    if (!userId || retrying) return;
    refocusFigures.current = true;
    setRetrying(true);
    try {
      await feed.reload(userId);
    } finally {
      setRetrying(false);
    }
  }

  if (account.status === "loading") return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading…</div>;
  if (account.status === "unconfigured") return <EmptyState title="Activity tracking isn’t connected" description="FITX is not connected to its database on this site." />;
  if (account.status === "error") return <AccountError />;
  if (account.status === "signed-out") return <EmptyState title={`Sign in to track ${SPORT_PLURAL[sport].toLowerCase()}`} description="Your activities are saved to your account." action={<Link href={`/signin?next=${sportHref(sport)}`} className="fitx-button min-h-11">Sign in</Link>} />;

  const summary = feed.statRows && feed.now !== null ? sportSummary(feed.statRows, sport, feed.now) : null;
  const known = summary !== null;
  const longest = summary?.bests.longest ? summary.bests.longest.value / 1000 : null;
  const walking = known && summary.movingSeconds > 0 ? durationFigure(summary.movingSeconds) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 sm:space-y-10">
      <Hero sport={sport} />

      <section ref={figuresRef} tabIndex={-1} aria-label={`${SPORT_LABEL[sport]} statistics`} aria-busy={feed.statsStatus === "loading" || undefined} className="rounded-2xl">
        {/* Figures only once they are known: never "Not logged" while loading or after a failed request. */}
        {feed.statsStatus === "error" ? (
          <div role="alert" className="fitx-alert fitx-alert-danger flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{feed.statsOffline ? "You’re offline. Your figures will load when you’re back online." : "Your figures couldn’t load right now."}</span>
            {userId && <button type="button" ref={figuresRetryRef} onClick={() => void retryFigures()} aria-disabled={retrying || undefined} className="fitx-button fitx-button-secondary min-h-11 shrink-0 aria-disabled:cursor-progress aria-disabled:opacity-60"><RefreshCw size={15} aria-hidden="true" />Try again</button>}
          </div>
        ) : !known ? (
          <StatRow>
            <span className="sr-only">Loading your figures…</span>
            {[0, 1, 2, 3].map((i) => <div key={i} aria-hidden="true" className="h-[102px] rounded-2xl border border-fitx-border bg-fitx-surface-variant motion-safe:animate-pulse sm:h-[110px]" />)}
          </StatRow>
        ) : (
          <StatRow>
            <StatTile label="This week" value={known ? summary.weekDistanceM / 1000 : null} unit="km" format={km} hint={known ? `${summary.weekCount} ${summary.weekCount === 1 ? SPORT_NOUN[sport] : SPORT_PLURAL[sport].toLowerCase()}` : undefined} />
            <StatTile label="All time" value={known ? summary.distanceM / 1000 : null} unit="km" format={km} hint={known ? `${summary.count} ${summary.count === 1 ? SPORT_NOUN[sport] : SPORT_PLURAL[sport].toLowerCase()}` : undefined} />
            {usesPace(sport)
              ? <StatTile label="Average pace" value={summary?.avgPaceSecondsPerKm ?? null} unit="/km" format={(n) => paceValue(n)} />
              : <StatTile label="Average speed" value={summary?.avgSpeedMps != null ? summary.avgSpeedMps * 3.6 : null} unit="km/h" format={(n) => n.toFixed(1)} />}
            {sportFamily(sport) === "walk"
              ? <StatTile label={sport === "walk" ? "Time walking" : "Moving time"} value={walking?.value ?? null} unit={walking?.unit} format={walking?.format} />
              : <StatTile label={`Longest ${SPORT_NOUN[sport]}`} value={longest} unit="km" format={km} />}
          </StatRow>
        )}
      </section>

      <BestEffortsOverview state={efforts} only={sport} />
      {feed.statRows && <PersonalBestsPanel bests={personalBests(feed.statRows)} only={sport} />}

      <section aria-labelledby="sport-history-title" className="space-y-4">
        <h2 id="sport-history-title" ref={historyTitleRef} tabIndex={-1} className="font-heading text-xl font-bold tracking-[-.02em] text-fitx-text">Your {SPORT_PLURAL[sport].toLowerCase()}</h2>
        {feed.history.status === "error" && <p role="alert" className="fitx-alert fitx-alert-danger">{feed.history.offline ? "You’re offline. Your history will load when you’re back online." : "Your history couldn’t load right now."}</p>}
        <FeedList
          entries={feed.timeline.entries}
          now={feed.now}
          sport={sport}
          loading={feed.history.status === "loading"}
          ready={feed.history.status === "ready" || feed.history.status === "unavailable"}
          more={feed.history.status === "ready" && feed.timeline.more}
          loadingMore={feed.loadingMore}
          moreFailed={feed.moreFailed}
          onLoadMore={feed.loadMore}
          headingRef={historyTitleRef}
        />
      </section>
    </div>
  );
}
