// The Explore section's pure rules: words for reports and actions, which actions fit which report, the queue's
// filters, suspension lengths, the community and challenge forms (checked as 20261124100020_fitx_admin_explore checks
// them), challenge windows (O6: Monday to Monday and the 1st to the 1st, in Asia/Kolkata) and the Free-plan meter's
// arithmetic. No imports, so tests can load it.

export const EXPLORE_MIGRATION = "20261124100020_fitx_admin_explore";

export const REPORT_REASONS = ["spam", "harassment", "hate", "nudity", "violence", "self_harm", "false_information", "scam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  harassment: "Bullying or harassment",
  hate: "Hate speech",
  nudity: "Nudity or sexual content",
  violence: "Violence",
  self_harm: "Self-harm",
  false_information: "False information",
  scam: "Scam or fraud",
  other: "Something else",
};

export const TARGET_TYPES = ["post", "comment", "story", "message", "community", "challenge", "account"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const TARGET_LABELS: Record<TargetType, string> = {
  post: "Post",
  comment: "Comment",
  story: "Story",
  message: "Message",
  community: "Community",
  challenge: "Challenge",
  account: "Account",
};

export const REPORT_STATUSES = ["open", "reviewing", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const STATUS_LABELS: Record<ReportStatus, string> = { open: "Open", reviewing: "In review", actioned: "Actioned", dismissed: "Dismissed" };

export const MODERATION_ACTIONS = ["dismiss", "claim", "limit", "hide", "unhide", "remove", "clear_avatar", "clear_bio", "warn", "suspend", "lift"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** The button each action shows (BRIEF-2 section 5 names several of them). */
export const ACTION_LABELS: Record<ModerationAction, string> = {
  dismiss: "Dismiss",
  claim: "Take for review",
  limit: "Limit",
  hide: "Hide",
  unhide: "Unhide",
  remove: "Remove",
  clear_avatar: "Clear photo",
  clear_bio: "Clear bio",
  warn: "Warn",
  suspend: "Suspend from Explore",
  lift: "Lift suspension",
};

/** Actions that need a reason code (the database refuses them without one). */
export const NEEDS_REASON: readonly ModerationAction[] = ["limit", "hide", "remove", "clear_avatar", "clear_bio", "warn", "suspend"];
/** Actions that cannot be undone from Admin, so their button asks twice. */
export const IRREVERSIBLE: readonly ModerationAction[] = ["remove", "clear_avatar", "clear_bio"];

export type ContentState = "visible" | "limited" | "hidden" | "gone";

/**
 * The content actions a report offers: none for an account or a challenge (FITX's own), no Remove for a community,
 * no Limit for a message; Unhide only for limited or hidden content; nothing once the content is gone.
 */
export function contentActionsFor(target: TargetType, state: ContentState): ModerationAction[] {
  if (target === "account" || target === "challenge" || state === "gone") return [];
  if (state !== "visible") {
    const actions: ModerationAction[] = ["unhide"];
    if (state === "limited") actions.push("hide");
    if (target !== "community") actions.push("remove");
    return actions;
  }
  const actions: ModerationAction[] = [];
  if (target !== "message") actions.push("limit");
  actions.push("hide");
  if (target !== "community") actions.push("remove");
  return actions;
}

export function isReason(value: unknown): value is ReportReason {
  return typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value);
}
export function isAction(value: unknown): value is ModerationAction {
  return typeof value === "string" && (MODERATION_ACTIONS as readonly string[]).includes(value);
}
export function isTargetType(value: unknown): value is TargetType {
  return typeof value === "string" && (TARGET_TYPES as readonly string[]).includes(value);
}
export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === "string" && (REPORT_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------------------------- Queue

export type QueueFilters = { status: "waiting" | ReportStatus | "all"; target: TargetType | null; page: number };
export const QUEUE_PAGE_SIZE = 25;

type Params = Record<string, string | string[] | undefined>;
function first(params: Params, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
}

/** ?status=waiting (open and in review, the default) | open | reviewing | actioned | dismissed | all, ?type=, ?page=. */
export function parseQueueFilters(params: Params): QueueFilters {
  const status = first(params, "status");
  const target = first(params, "type");
  const page = Number(first(params, "page") || "1");
  return {
    status: status === "all" || isReportStatus(status) ? status : "waiting",
    target: isTargetType(target) ? target : null,
    page: Number.isInteger(page) && page >= 1 && page <= 2000 ? page : 1,
  };
}

export function queueHref(filters: QueueFilters, overrides: Partial<QueueFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const query = new URLSearchParams();
  if (merged.status !== "waiting") query.set("status", merged.status);
  if (merged.target) query.set("type", merged.target);
  if (merged.page > 1) query.set("page", String(merged.page));
  const text = query.toString();
  return `/explore${text ? `?${text}` : ""}`;
}

/** The statuses a filter reads from the database. */
export function statusesFor(filter: QueueFilters["status"]): readonly ReportStatus[] {
  if (filter === "waiting") return ["open", "reviewing"];
  if (filter === "all") return REPORT_STATUSES;
  return [filter];
}

// ------------------------------------------------------------------------------------------------------------ Sanctions

export const SANCTION_KINDS = ["explore", "dm", "upload"] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];
export const SANCTION_LABELS: Record<SanctionKind, string> = { explore: "Explore", dm: "Messages", upload: "Uploads" };

export const SUSPENSION_LENGTHS = ["7d", "30d", "indefinite"] as const;
export type SuspensionLength = (typeof SUSPENSION_LENGTHS)[number];
export const SUSPENSION_LABELS: Record<SuspensionLength, string> = { "7d": "7 days", "30d": "30 days", indefinite: "Until lifted" };

export function isSanctionKind(value: unknown): value is SanctionKind {
  return typeof value === "string" && (SANCTION_KINDS as readonly string[]).includes(value);
}
export function isSuspensionLength(value: unknown): value is SuspensionLength {
  return typeof value === "string" && (SUSPENSION_LENGTHS as readonly string[]).includes(value);
}

/** The end of a suspension of `length` starting `now`, or null for one that lasts until it is lifted. */
export function suspensionUntil(length: SuspensionLength, now = Date.now()): string | null {
  if (length === "indefinite") return null;
  return new Date(now + (length === "7d" ? 7 : 30) * 86_400_000).toISOString();
}

/** A sanction is active when it was not lifted and has no end, or ends in the future. */
export function sanctionActive(sanction: { liftedAt: string | null; until: string | null }, now = Date.now()): boolean {
  return !sanction.liftedAt && (!sanction.until || Date.parse(sanction.until) > now);
}

// ------------------------------------------------------------------------------------------------------- Error messages

/** The notice a refused database call leads to, from the message the Explore functions raise. */
export function moderationNotice(error: { code?: string; message?: string } | null): string {
  if (!error) return "failed";
  const message = error.message ?? "";
  if (error.code === "42501") return "forbidden";
  if (error.code === "23505") return "slug_taken";
  const known = message.match(/^explore_([a-z_]+)$/);
  if (known && ["P0002", "22023"].includes(error.code ?? "")) return known[1];
  return "failed";
}

// ----------------------------------------------------------------------------------------------------------- Communities

export const COMMUNITY_LIMITS = { name: 60, description: 500, slugMin: 3, slugMax: 40 } as const;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export type CommunityInput = { slug: string; name: string; description: string; visibility: "public" | "private" };

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim() : "";
}
const chars = (text: string) => Array.from(text).length;

/** A name as a suggested address: "Morning Runners" → "morning-runners". */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, COMMUNITY_LIMITS.slugMax)
    .replace(/-+$/g, "");
}

export function validateCommunity(input: { slug: unknown; name: unknown; description: unknown; visibility: unknown }): { ok: true; value: CommunityInput } | { ok: false; error: string } {
  const name = clean(input.name);
  const slug = clean(input.slug).toLowerCase() || slugFromName(name);
  const description = clean(input.description);
  if (chars(name) < 1 || chars(name) > COMMUNITY_LIMITS.name) return { ok: false, error: `The name needs 1 to ${COMMUNITY_LIMITS.name} characters.` };
  if (!SLUG.test(slug)) return { ok: false, error: "The address needs 3 to 40 lower-case letters, digits or dashes, starting and ending with a letter or digit." };
  if (chars(description) > COMMUNITY_LIMITS.description) return { ok: false, error: `The description can have at most ${COMMUNITY_LIMITS.description} characters.` };
  if (input.visibility !== "public" && input.visibility !== "private") return { ok: false, error: "Choose public or private." };
  return { ok: true, value: { slug, name, description, visibility: input.visibility } };
}

/** Where a community's cover lives in the social-media bucket (the database refuses any other path). */
export function coverPath(communityId: string): string {
  return `communities/${communityId}/cover.webp`;
}
export const COVER_MAX_BYTES = 900_000;

// ------------------------------------------------------------------------------------------------------------ Challenges

export const CHALLENGE_KINDS = ["weekly", "monthly"] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];
export const CHALLENGE_METRICS = ["workouts", "active_minutes", "distance_km", "active_days"] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number];

export const METRIC_LABELS: Record<ChallengeMetric, { label: string; unit: string }> = {
  workouts: { label: "Workouts completed", unit: "workouts" },
  active_minutes: { label: "Active minutes", unit: "minutes" },
  distance_km: { label: "Distance", unit: "km" },
  active_days: { label: "Active days", unit: "days" },
};

/** The sports a distance or active-minutes challenge may count (activities.sport). */
export const CHALLENGE_SPORTS = ["walk", "run", "ride", "hike", "trail_run", "mtb", "ebike", "wheelchair", "skate", "paddle"] as const;
export type ChallengeSport = (typeof CHALLENGE_SPORTS)[number];
export const SPORT_LABELS: Record<ChallengeSport, string> = {
  walk: "Walk", run: "Run", ride: "Ride", hike: "Hike", trail_run: "Trail run", mtb: "Mountain bike", ebike: "E-bike",
  wheelchair: "Wheelchair", skate: "Inline skate", paddle: "Paddle",
};

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/**
 * The window of a challenge that contains the IST calendar day `day` ("YYYY-MM-DD"): a weekly one from that week's
 * Monday 00:00 IST for 7 days, a monthly one from the 1st 00:00 IST to the next 1st. Null for a malformed day.
 */
export function challengeWindow(kind: ChallengeKind, day: string): { startsAt: string; endsAt: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utcMidnight = Date.UTC(year, month - 1, date);
  if (new Date(utcMidnight).getUTCDate() !== date) return null;
  if (kind === "weekly") {
    const weekday = (new Date(utcMidnight).getUTCDay() + 6) % 7; // Monday 0
    const start = utcMidnight - weekday * DAY_MS - IST_OFFSET_MS;
    return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 7 * DAY_MS).toISOString() };
  }
  const start = Date.UTC(year, month - 1, 1) - IST_OFFSET_MS;
  const end = Date.UTC(year, month, 1) - IST_OFFSET_MS;
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}

/** Today's IST calendar day, "YYYY-MM-DD". */
export function istToday(now = Date.now()): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export type ChallengeInput = {
  kind: ChallengeKind; title: string; metric: ChallengeMetric; sport: ChallengeSport | null; target: number | null;
  startsAt: string; endsAt: string; communityId: string | null;
};
export type TemplateInput = Omit<ChallengeInput, "startsAt" | "endsAt" | "communityId"> & { active: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function common(input: { kind: unknown; title: unknown; metric: unknown; sport: unknown; target: unknown }):
  { ok: true; value: Omit<TemplateInput, "active"> } | { ok: false; error: string } {
  const title = clean(input.title);
  if (input.kind !== "weekly" && input.kind !== "monthly") return { ok: false, error: "Choose weekly or monthly." };
  if (chars(title) < 1 || chars(title) > 80) return { ok: false, error: "The title needs 1 to 80 characters." };
  if (!(CHALLENGE_METRICS as readonly unknown[]).includes(input.metric)) return { ok: false, error: "Choose what the challenge counts." };
  const metric = input.metric as ChallengeMetric;
  const sportText = clean(input.sport);
  let sport: ChallengeSport | null = null;
  if (sportText) {
    if (metric !== "distance_km" && metric !== "active_minutes") return { ok: false, error: "A sport applies only to distance and active minutes." };
    if (!(CHALLENGE_SPORTS as readonly string[]).includes(sportText)) return { ok: false, error: "Choose a sport from the list." };
    sport = sportText as ChallengeSport;
  }
  const targetText = clean(input.target);
  let target: number | null = null;
  if (targetText) {
    const value = Number(targetText);
    if (!Number.isFinite(value) || value <= 0 || value > 100000) return { ok: false, error: "The target must be a number above 0 (up to 100,000), or empty." };
    target = Math.round(value * 100) / 100;
  }
  return { ok: true, value: { kind: input.kind, title, metric, sport, target } };
}

export function validateChallenge(input: { kind: unknown; title: unknown; metric: unknown; sport: unknown; target: unknown; day: unknown; communityId: unknown }, now = Date.now()):
  { ok: true; value: ChallengeInput } | { ok: false; error: string } {
  const base = common(input);
  if (!base.ok) return base;
  const window = typeof input.day === "string" ? challengeWindow(base.value.kind, input.day) : null;
  if (!window) return { ok: false, error: "Choose the week or month it runs in." };
  if (Date.parse(window.endsAt) <= now) return { ok: false, error: "That week or month is over. Choose this one or a later one." };
  const community = clean(input.communityId);
  if (community && !UUID.test(community)) return { ok: false, error: "Choose a community from the list, or none." };
  return { ok: true, value: { ...base.value, ...window, communityId: community ? community.toLowerCase() : null } };
}

export function validateTemplate(input: { kind: unknown; title: unknown; metric: unknown; sport: unknown; target: unknown; active: unknown }):
  { ok: true; value: TemplateInput } | { ok: false; error: string } {
  const base = common(input);
  if (!base.ok) return base;
  return { ok: true, value: { ...base.value, active: input.active === true } };
}

/** "Mon 23 Nov to Mon 30 Nov" style window text in IST. */
export function windowText(startsAt: string, endsAt: string): string {
  const format = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
  return `${format(startsAt)} to ${format(endsAt)}`;
}

/** Whether a challenge is upcoming, running, waiting to be closed (ended, not closed yet) or closed. */
export function challengePhase(c: { startsAt: string; endsAt: string; closedAt: string | null }, now = Date.now()): "upcoming" | "running" | "ending" | "closed" {
  if (c.closedAt) return "closed";
  if (Date.parse(c.startsAt) > now) return "upcoming";
  if (Date.parse(c.endsAt) > now) return "running";
  return "ending";
}

// ----------------------------------------------------------------------------------------------------- Free-plan meter

/** The Supabase Free plan's limits the meter compares against (supabase.com, billing on Supabase). */
export const FREE_PLAN = { storageBytes: 1024 ** 3, databaseBytes: 500 * 1024 ** 2, egressBytes: 5 * 1024 ** 3 } as const;

/** Bytes in plain words: "812 KB", "3.4 MB", "1.02 GB". */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "Not known";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, "")} ${units[unit]}`;
}

/** A share of a limit, 0 to 1 (more than 1 when over), or null when either side is unknown. */
export function share(used: number | null, limit: number | null): number | null {
  if (used === null || limit === null || !(limit > 0)) return null;
  return used / limit;
}

/** The tone of a meter: under 70% calm, under 90% a warning, from 90% on a danger. */
export function meterTone(fraction: number | null): "good" | "warn" | "danger" | "neutral" {
  if (fraction === null) return "neutral";
  return fraction >= 0.9 ? "danger" : fraction >= 0.7 ? "warn" : "good";
}
