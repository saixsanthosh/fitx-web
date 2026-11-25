/**
 * Challenges, typed (supabase/migrations/20261124100010_fitx_social_v2_groups.sql). Values are always computed by the
 * database from the member's own completed workouts and activities; members never type a number, and nothing here
 * invents one.
 */
import { SPORT_LABEL } from "@/lib/activity/config";
import { toSocialError } from "./errors";
import type { Db } from "./api";
import type { SocialAuthor, SocialPost } from "./types";
import { CHALLENGE_TIME_ZONE, GROUP_LIMITS } from "./group-limits";

export type ChallengeMetric = "workouts" | "active_minutes" | "distance_km" | "active_days";
export type ChallengeBadge = "completed" | "top3";

export type ChallengeEntry = { value: number; on_leaderboard: boolean; joined_at: string; synced_at: string | null; rank: number | null };

export type Challenge = {
  id: string;
  kind: "weekly" | "monthly";
  title: string;
  metric: ChallengeMetric;
  sport: string | null;
  target: number | null;
  starts_at: string;
  ends_at: string;
  closed_at: string | null;
  community: { slug: string; name: string } | null;
  participants: number;
  joined: boolean;
  entry: ChallengeEntry | null;
  badges: ChallengeBadge[];
};

export type ChallengePage = Challenge & {
  last_synced_at: string | null;
  /** Leaderboards are for adults (O1 a). */
  board_allowed: boolean;
  board_size: number | null;
  posts: (SocialPost & { entry: { value: number; rank: number | null } | null })[];
};

export type BoardRow = { rank: number; value: number; mine: boolean; user: SocialAuthor };
export type Board = { size: number; rows: BoardRow[]; me: { rank: number; value: number } | null };

async function call<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw toSocialError(error);
  return data as T;
}

export const challengesApi = {
  list: (db: Db, box: "open" | "closed" = "open") => call<Challenge[]>(db, "fitx_social_challenges", { p_box: box }),
  get: (db: Db, id: string) => call<ChallengePage | null>(db, "fitx_social_challenge", { p_challenge: id }),
  join: (db: Db, id: string) => call<ChallengePage>(db, "fitx_social_join_challenge", { p_challenge: id }),
  leave: (db: Db, id: string) => call<boolean>(db, "fitx_social_leave_challenge", { p_challenge: id }),
  setLeaderboard: (db: Db, id: string, on: boolean) => call<ChallengePage>(db, "fitx_social_set_leaderboard", { p_challenge: id, p_on: on }),
  board: (db: Db, id: string) => call<Board>(db, "fitx_social_challenge_board", { p_challenge: id }),
};

const METRIC_UNIT: Record<ChallengeMetric, { one: string; many: string }> = {
  workouts: { one: "workout", many: "workouts" },
  active_minutes: { one: "active minute", many: "active minutes" },
  distance_km: { one: "km", many: "km" },
  active_days: { one: "active day", many: "active days" },
};

/** A value with its unit: "3 workouts", "12.5 km", "1 active day". */
export function formatValue(metric: ChallengeMetric, value: number): string {
  const unit = METRIC_UNIT[metric];
  const shown = metric === "distance_km"
    ? value.toLocaleString("en-GB", { maximumFractionDigits: value >= 100 ? 0 : 1 })
    : Math.floor(value).toLocaleString("en-GB");
  return `${shown} ${value === 1 ? unit.one : unit.many}`;
}

/** What counts, in one short line: "Completed workouts", "Run distance", "Active minutes from workouts and activities". */
export function metricText(metric: ChallengeMetric, sport: string | null): string {
  const sportName = sport ? (SPORT_LABEL as Record<string, string>)[sport] ?? sport.replace(/_/g, " ") : null;
  switch (metric) {
    case "workouts": return "Completed workouts";
    case "distance_km": return sportName ? `${sportName} distance` : "Distance from your activities";
    case "active_minutes": return sportName ? `Active minutes on ${sportName.toLowerCase()} activities` : "Active minutes from workouts and activities";
    case "active_days": return sportName ? `Days with a ${sportName.toLowerCase()}` : "Days with a workout or activity";
  }
}

/** The goal in words, or null when the challenge has no target (most wins). */
export function targetText(challenge: Pick<Challenge, "metric" | "target">): string | null {
  return challenge.target === null || challenge.target === undefined ? null : formatValue(challenge.metric, Number(challenge.target));
}

export type ChallengePhase = "upcoming" | "open" | "closing" | "closed";

/** Where a challenge stands at `now`: not started, running, ended and waiting for the final count, or closed. */
export function challengePhase(challenge: Pick<Challenge, "starts_at" | "ends_at" | "closed_at">, now: Date = new Date()): ChallengePhase {
  if (challenge.closed_at) return "closed";
  const time = now.getTime();
  if (time < new Date(challenge.starts_at).getTime()) return "upcoming";
  if (time < new Date(challenge.ends_at).getTime()) return "open";
  return "closing";
}

/** Progress towards the target, 0 to 1, or null without a target. */
export function progressShare(value: number | null | undefined, target: number | null | undefined): number | null {
  if (target === null || target === undefined || !(Number(target) > 0) || value === null || value === undefined) return null;
  return Math.max(0, Math.min(1, Number(value) / Number(target)));
}

const dayFormat = (zone: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: zone });

/** The last day of a window: windows end at midnight, so the day before the end. */
const lastDayOf = (challenge: Pick<Challenge, "ends_at">) => new Date(new Date(challenge.ends_at).getTime() - 1);

/**
 * The challenge's dates in India time, where the windows are counted (O6 a: "Mon 23 Nov to Sun 29 Nov", whatever the
 * browser's zone). The last day shown is the day before the end.
 */
export function windowText(challenge: Pick<Challenge, "starts_at" | "ends_at">, zone: string = CHALLENGE_TIME_ZONE): string {
  const format = dayFormat(zone);
  return `${format.format(new Date(challenge.starts_at))} to ${format.format(lastDayOf(challenge))}`;
}

/** "Ends in 3 days", "Ends in 5 h", "Starts tomorrow", "Final count soon", "Ended 29 Nov" (the window's last day, India time). */
export function timeLeftText(challenge: Pick<Challenge, "starts_at" | "ends_at" | "closed_at">, now: Date = new Date(), zone: string = CHALLENGE_TIME_ZONE): string {
  const phase = challengePhase(challenge, now);
  if (phase === "closed") return `Ended ${lastDayOf(challenge).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: zone })}`;
  if (phase === "closing") return "Final count soon";
  const target = new Date(phase === "upcoming" ? challenge.starts_at : challenge.ends_at).getTime();
  const hours = Math.max(0, Math.round((target - now.getTime()) / 3_600_000));
  const verb = phase === "upcoming" ? "Starts" : "Ends";
  if (hours < 1) return `${verb} within the hour`;
  if (hours < 36) return `${verb} in ${hours} h`;
  return `${verb} in ${Math.round(hours / 24)} days`;
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  return `${rank}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[rank % 10] ?? "th"}`;
}

export const BADGE_TEXT: Record<ChallengeBadge, { title: string; text: string }> = {
  completed: { title: "Completed", text: "You reached the target." },
  top3: { title: "Top 3", text: `You finished in the top three of a board of ${GROUP_LIMITS.top3MinimumBoard} or more.` },
};

/** How the window is counted, in plain words, for the challenge page. */
export function countingNote(challenge: Pick<Challenge, "kind">): string {
  const window = challenge.kind === "weekly" ? "Monday to Monday" : "the 1st to the 1st";
  return `Counted from your own workouts and activities from when you join, ${window}, India time (${CHALLENGE_TIME_ZONE}). Results are final ${GROUP_LIMITS.closeGraceHours} hours after the end.`;
}

/**
 * Community's Challenges section is always there, with its "All challenges" link, so finished challenges and their
 * results stay one step away even when none is open (bug 60). Under the heading: the open ones (up to three), or this
 * line. Null while loading or while there are open ones to show; a failed load never reads as "none open".
 */
export function communityChallengesNote(open: readonly Challenge[] | "failed" | null): { text: string; finishedLink: boolean } | null {
  if (open === null) return null;
  if (open === "failed") return { text: "Challenges did not load. Open All challenges to try again.", finishedLink: false };
  if (open.length) return null;
  return { text: "No challenge is open right now. FITX opens weekly and monthly ones here.", finishedLink: true };
}

/** "No one has joined yet", "1 taking part", "1,204 taking part". */
export function participantsText(count: number): string {
  if (!count) return "No one has joined yet";
  return `${count.toLocaleString("en-GB")} taking part`;
}
