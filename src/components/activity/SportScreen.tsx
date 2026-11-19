"use client";

import Link from "next/link";
import { m } from "framer-motion";
import { ChevronLeft, Play } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { EASE } from "@/components/motion";
import { StatRow, StatTile } from "@/components/ui/StatTile";
import { SPORT_LABEL, SPORT_NOUN } from "@/lib/activity/config";
import { sportSummary } from "@/lib/activity/feed";
import { paceValue } from "@/lib/activity/format";
import { personalBests } from "@/lib/activity/stats";
import type { Sport } from "@/lib/activity/types";
import { AccountError } from "./AccountError";
import { PersonalBestsPanel } from "./ActivityStats";
import { FeedList } from "./FeedList";
import { recordHref, SPORT_PLURAL, SportIcon } from "./sports";
import { useActivityAccount } from "./useActivityAccount";
import { useActivityFeed } from "./useActivityFeed";

/** FITX's own line art per sport: a short loop for walks, a longer out-and-back for runs, a sweeping road for rides. */
const ROUTE_ART: Record<Sport, string> = {
  walk: "M40 150 C 70 92, 128 84, 160 112 S 236 168, 268 120 S 300 54, 248 42 S 150 60, 120 30",
  run: "M24 160 C 64 150, 76 96, 116 92 S 170 128, 204 96 S 232 30, 276 40 S 320 92, 296 132 S 236 168, 200 150",
  ride: "M10 140 C 70 140, 90 60, 150 60 S 220 150, 280 120 S 320 40, 340 30",
};

const km = (n: number) => n.toFixed(2);

function Hero({ sport }: { sport: Sport }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-fitx-stage text-fitx-on-stage" aria-labelledby="sport-title">
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

  if (account.status === "loading") return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading…</div>;
  if (account.status === "unconfigured") return <EmptyState title="Activity tracking isn’t connected" description="FITX is not connected to its database on this site." />;
  if (account.status === "error") return <AccountError />;
  if (account.status === "signed-out") return <EmptyState title={`Sign in to track ${SPORT_PLURAL[sport].toLowerCase()}`} description="Your activities are saved to your account." action={<Link href={`/signin?next=/activity/${sport}`} className="fitx-button min-h-11">Sign in</Link>} />;

  const summary = feed.statRows && feed.now !== null ? sportSummary(feed.statRows, sport, feed.now) : null;
  const known = summary !== null;
  const longest = summary?.bests.longest ? summary.bests.longest.value / 1000 : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 sm:space-y-10">
      <Hero sport={sport} />

      <section aria-label={`${SPORT_LABEL[sport]} statistics`}>
        <StatRow>
          <StatTile label="This week" value={known ? summary.weekDistanceM / 1000 : null} unit="km" format={km} hint={known ? `${summary.weekCount} ${summary.weekCount === 1 ? SPORT_NOUN[sport] : SPORT_PLURAL[sport].toLowerCase()}` : undefined} />
          <StatTile label="All time" value={known ? summary.distanceM / 1000 : null} unit="km" format={km} hint={known ? `${summary.count} ${summary.count === 1 ? SPORT_NOUN[sport] : SPORT_PLURAL[sport].toLowerCase()}` : undefined} />
          {sport === "ride"
            ? <StatTile label="Average speed" value={summary?.avgSpeedMps != null ? summary.avgSpeedMps * 3.6 : null} unit="km/h" format={(n) => n.toFixed(1)} />
            : <StatTile label="Average pace" value={summary?.avgPaceSecondsPerKm ?? null} unit="/km" format={(n) => paceValue(n)} />}
          {sport === "walk"
            ? <StatTile label="Time walking" value={known && summary.movingSeconds > 0 ? summary.movingSeconds / 3600 : null} unit="h" format={(n) => n.toFixed(1)} />
            : <StatTile label={sport === "run" ? "Longest run" : "Longest ride"} value={longest} unit="km" format={km} />}
        </StatRow>
      </section>

      {feed.statRows && <PersonalBestsPanel bests={personalBests(feed.statRows)} only={sport} />}

      <section aria-labelledby="sport-history-title" className="space-y-4">
        <h2 id="sport-history-title" className="font-heading text-xl font-bold tracking-[-.02em] text-fitx-text">Your {SPORT_PLURAL[sport].toLowerCase()}</h2>
        {feed.history.status === "error" && <p role="alert" className="fitx-alert fitx-alert-danger">{feed.history.offline ? "You’re offline. Your history will load when you’re back online." : "Your history couldn’t load right now."}</p>}
        <FeedList
          entries={feed.timeline.entries}
          now={feed.now}
          sport={sport}
          loading={feed.history.status === "loading"}
          ready={feed.history.status === "ready" || feed.history.status === "unavailable"}
          more={feed.history.status === "ready" && feed.timeline.more}
          loadingMore={feed.loadingMore}
          onLoadMore={() => void feed.loadMore()}
        />
      </section>
    </div>
  );
}
