import "server-only";
import { cache } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { usernamesFor } from "@/lib/data/members";
import { isUuid } from "@/lib/data/people";
import {
  QUEUE_PAGE_SIZE,
  REPORT_STATUSES,
  isReason,
  isReportStatus,
  isTargetType,
  sanctionActive,
  statusesFor,
  type ChallengeKind,
  type ChallengeMetric,
  type ContentState,
  type QueueFilters,
  type ReportReason,
  type ReportStatus,
  type SanctionKind,
  type TargetType,
} from "@/lib/explore-rules";
import { logServerError } from "@/lib/log";
import { isMissingSchema } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

// Admin's reads of Explore (members' reports, accounts, communities, challenges and the Free-plan meter), all with the
// server key. Each export checks explore.view itself. Message and conversation tables are read only in
// explore-evidence.ts (admin/tests/explore-privacy.test.mjs keeps it so): a moderator sees the reported message alone.

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;
type Row = Record<string, unknown>;
export type NotReady = { state: "service_key_missing" | "migration_pending" | "query_failed" };

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null);

/**
 * Whether migration 20261124100020 is applied: its role table gives support agents explore.view. One cheap call per
 * request (fitx_admin_role_permissions is immutable). Everything in this section waits for it.
 */
export const exploreReadiness = cache(async (): Promise<"ready" | NotReady["state"]> => {
  const admin = createAdminSupabase();
  if (!admin) return "service_key_missing";
  const { data, error } = await admin.rpc("fitx_admin_role_permissions", { p_role: "support_agent" });
  if (error) {
    if (isMissingSchema(error)) return "migration_pending";
    logServerError("data.explore_readiness", error);
    return "query_failed";
  }
  return Array.isArray(data) && data.includes("explore.view") ? "ready" : "migration_pending";
});

async function ready(): Promise<{ admin: AdminClient } | NotReady> {
  const state = await exploreReadiness();
  if (state !== "ready") return { state };
  const admin = createAdminSupabase();
  return admin ? { admin } : { state: "service_key_missing" };
}

/** Explore usernames by account id (members without an Explore profile are left out). */
async function exploreNames(admin: AdminClient, ids: Array<string | null | undefined>): Promise<Map<string, { username: string; displayName: string }>> {
  const unique = [...new Set(ids.filter((id): id is string => isUuid(id)))].slice(0, 500);
  const names = new Map<string, { username: string; displayName: string }>();
  if (!unique.length) return names;
  const { data, error } = await admin.from("social_profiles").select("user_id,username,display_name").in("user_id", unique);
  if (error) {
    logServerError("data.explore_names", error);
    return names;
  }
  for (const row of (data ?? []) as Row[]) names.set(String(row.user_id), { username: String(row.username), displayName: String(row.display_name) });
  return names;
}

// ---------------------------------------------------------------------------------------------------------------- Queue

/** Open and in-review reports, for the navigation badge; null when unknown (never 0 for "could not count"). */
export async function getExploreWaiting(): Promise<number | null> {
  await requireAdmin("explore.view");
  const base = await ready();
  if (!("admin" in base)) return null;
  const { count, error } = await base.admin.from("social_reports").select("id", { count: "exact", head: true }).in("status", ["open", "reviewing"]);
  if (error) {
    logServerError("data.explore_waiting", error);
    return null;
  }
  return count ?? null;
}

export type QueueRow = {
  id: string;
  targetType: TargetType;
  targetId: string;
  targetUserId: string | null;
  targetName: string | null;
  reporterName: string | null;
  reason: ReportReason;
  status: ReportStatus;
  createdAt: string;
  reviewedAt: string | null;
  /** Open or in-review reports on the same item, this one included. */
  waitingOnTarget: number;
  hasDetails: boolean;
};

export type QueueResult =
  | { state: "ready"; rows: QueueRow[]; total: number; hasNext: boolean; counts: Record<ReportStatus, number> }
  | NotReady;

/** The queue: oldest first while waiting, newest first for closed and all reports. */
export async function listReports(filters: QueueFilters): Promise<QueueResult> {
  await requireAdmin("explore.view");
  const base = await ready();
  if (!("admin" in base)) return base;
  const { admin } = base;
  const offset = (filters.page - 1) * QUEUE_PAGE_SIZE;
  let query = admin
    .from("social_reports")
    .select("id,user_id,target_type,target_id,target_user_id,reason,details,status,created_at,reviewed_at", { count: "exact" })
    .in("status", [...statusesFor(filters.status)])
    .order("created_at", { ascending: filters.status === "waiting" || filters.status === "open" || filters.status === "reviewing" })
    .order("id")
    .range(offset, offset + QUEUE_PAGE_SIZE - 1);
  if (filters.target) query = query.eq("target_type", filters.target);
  const [list, ...statusCounts] = await Promise.all([
    query,
    ...REPORT_STATUSES.map((status) => admin.from("social_reports").select("id", { count: "exact", head: true }).eq("status", status)),
  ]);
  if (list.error) {
    logServerError("data.explore_reports", list.error);
    return { state: "query_failed" };
  }
  const rows = (list.data ?? []) as Row[];
  const targets = [...new Set(rows.map((row) => String(row.target_id)))];
  const [names, waiting] = await Promise.all([
    exploreNames(admin, rows.flatMap((row) => [row.user_id as string, row.target_user_id as string | null])),
    targets.length
      ? admin.from("social_reports").select("target_id").in("target_id", targets).in("status", ["open", "reviewing"]).limit(2000)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  const waitingCount = new Map<string, number>();
  for (const row of (waiting.data ?? []) as Row[]) waitingCount.set(String(row.target_id), (waitingCount.get(String(row.target_id)) ?? 0) + 1);
  const counts = Object.fromEntries(REPORT_STATUSES.map((status, index) => [status, statusCounts[index].count ?? 0])) as Record<ReportStatus, number>;
  const total = list.count ?? rows.length;
  return {
    state: "ready",
    counts,
    total,
    hasNext: offset + rows.length < total,
    rows: rows.flatMap((row) => {
      if (!isTargetType(row.target_type) || !isReason(row.reason) || !isReportStatus(row.status)) return [];
      return [{
        id: String(row.id),
        targetType: row.target_type,
        targetId: String(row.target_id),
        targetUserId: text(row.target_user_id),
        targetName: row.target_user_id ? (names.get(String(row.target_user_id))?.username ?? null) : null,
        reporterName: names.get(String(row.user_id))?.username ?? null,
        reason: row.reason,
        status: row.status,
        createdAt: String(row.created_at),
        reviewedAt: text(row.reviewed_at),
        waitingOnTarget: waitingCount.get(String(row.target_id)) ?? 0,
        hasDetails: Boolean(text(row.details)),
      }];
    }),
  };
}

// ------------------------------------------------------------------------------------------------------- Report detail

export type ModerationEntry = { id: string; action: string; operator: string | null; actorKind: "operator" | "member"; reason: string | null; createdAt: string; reversedAt: string | null; reports: number };

export type ReportDetail = {
  id: string;
  reporterId: string;
  reporterName: string | null;
  targetType: TargetType;
  targetId: string;
  targetUserId: string | null;
  targetName: string | null;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  reviewedAt: string | null;
  evidence: Record<string, unknown> | null;
  evidencePurgeAt: string | null;
  /** The reported item now: its moderation state, or gone (deleted by its owner or removed). */
  contentState: ContentState;
  otherReports: Array<{ id: string; reason: ReportReason; status: ReportStatus; createdAt: string }>;
  history: ModerationEntry[];
  activeSanctions: Array<{ kind: SanctionKind; until: string | null }>;
};

const CONTENT_TABLES: Partial<Record<TargetType, string>> = { post: "social_posts", comment: "social_comments", story: "social_stories", community: "social_communities" };

/** The moderation state of a post, comment, story or community (messages: explore-evidence.ts). */
async function contentStateOf(admin: AdminClient, type: TargetType, id: string): Promise<ContentState | null> {
  const table = CONTENT_TABLES[type];
  if (!table) return null;
  const { data, error } = await admin.from(table).select("moderation_state").eq("id", id).maybeSingle();
  if (error) {
    logServerError("data.explore_content_state", error);
    return null;
  }
  if (!data) return "gone";
  const state = (data as Row).moderation_state;
  return state === "limited" || state === "hidden" ? state : "visible";
}

async function moderationHistory(admin: AdminClient, filter: { targetType?: string; targetId?: string; userId?: string }): Promise<ModerationEntry[]> {
  let query = admin.from("social_moderation_actions").select("id,actor_kind,operator_id,action,reason_code,report_ids,created_at,reversed_at").order("created_at", { ascending: false }).limit(30);
  if (filter.targetId) query = query.eq("target_id", filter.targetId);
  if (filter.targetType) query = query.eq("target_type", filter.targetType);
  if (filter.userId) query = query.eq("target_user_id", filter.userId);
  const { data, error } = await query;
  if (error) {
    logServerError("data.explore_history", error);
    return [];
  }
  const rows = (data ?? []) as Row[];
  const operators = await usernamesFor(rows.map((row) => row.operator_id as string | null));
  return rows.map((row) => ({
    id: String(row.id),
    action: String(row.action),
    operator: row.operator_id ? (operators.get(String(row.operator_id)) ?? null) : null,
    actorKind: row.actor_kind === "member" ? "member" : "operator",
    reason: text(row.reason_code),
    createdAt: String(row.created_at),
    reversedAt: text(row.reversed_at),
    reports: Array.isArray(row.report_ids) ? row.report_ids.length : 0,
  }));
}

async function activeSanctionsOf(admin: AdminClient, userId: string | null): Promise<ReportDetail["activeSanctions"]> {
  if (!userId) return [];
  const { data, error } = await admin.from("social_member_sanctions").select("kind,until,lifted_at").eq("user_id", userId).is("lifted_at", null);
  if (error) {
    logServerError("data.explore_sanctions", error);
    return [];
  }
  return ((data ?? []) as Row[])
    .filter((row) => sanctionActive({ liftedAt: text(row.lifted_at), until: text(row.until) }))
    .map((row) => ({ kind: row.kind as SanctionKind, until: text(row.until) }));
}

export type ReportResult = { state: "ready"; report: ReportDetail } | { state: "not_found" } | NotReady;

/**
 * One report with its evidence snapshot, the item's state now, the other reports on it, what moderators did to it
 * and the member's active suspensions. The page signs media links and records the view (explore_report_viewed).
 */
export async function getReport(id: string, messageState: (admin: AdminClient, messageId: string) => Promise<ContentState | null>): Promise<ReportResult> {
  await requireAdmin("explore.view");
  if (!isUuid(id)) return { state: "not_found" };
  const base = await ready();
  if (!("admin" in base)) return base;
  const { admin } = base;
  const { data, error } = await admin
    .from("social_reports")
    .select("id,user_id,target_type,target_id,target_user_id,reason,details,status,created_at,reviewed_at,evidence,evidence_purge_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logServerError("data.explore_report", error);
    return { state: "query_failed" };
  }
  const row = data as Row | null;
  if (!row || !isTargetType(row.target_type) || !isReason(row.reason) || !isReportStatus(row.status)) return { state: "not_found" };
  const targetType = row.target_type;
  const targetId = String(row.target_id);
  const targetUserId = text(row.target_user_id);
  const [names, others, history, sanctions, state] = await Promise.all([
    exploreNames(admin, [row.user_id as string, targetUserId]),
    admin.from("social_reports").select("id,reason,status,created_at").eq("target_type", targetType).eq("target_id", targetId).neq("id", id).order("created_at").limit(50),
    moderationHistory(admin, { targetType: targetType === "account" ? "account" : targetType, targetId }),
    activeSanctionsOf(admin, targetUserId),
    targetType === "message" ? messageState(admin, targetId) : targetType === "account" || targetType === "challenge" ? Promise.resolve<ContentState>("visible") : contentStateOf(admin, targetType, targetId),
  ]);
  const evidence = row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence) ? (row.evidence as Record<string, unknown>) : null;
  return {
    state: "ready",
    report: {
      id: String(row.id),
      reporterId: String(row.user_id),
      reporterName: names.get(String(row.user_id))?.username ?? null,
      targetType,
      targetId,
      targetUserId,
      targetName: targetUserId ? (names.get(targetUserId)?.username ?? null) : null,
      reason: row.reason,
      details: text(row.details),
      status: row.status,
      createdAt: String(row.created_at),
      reviewedAt: text(row.reviewed_at),
      evidence,
      evidencePurgeAt: text(row.evidence_purge_at),
      contentState: state ?? "visible",
      otherReports: ((others.data ?? []) as Row[]).flatMap((other) => (isReason(other.reason) && isReportStatus(other.status)
        ? [{ id: String(other.id), reason: other.reason, status: other.status, createdAt: String(other.created_at) }] : [])),
      history,
      activeSanctions: sanctions,
    },
  };
}

// ------------------------------------------------------------------------------------------------------ Account record

export type AccountRecord = {
  userId: string;
  profile: { username: string; displayName: string; bio: string; avatarPath: string | null; isPrivate: boolean; createdAt: string; birthDateAddedAt: string | null } | null;
  sanctions: Array<{ id: string; kind: SanctionKind; until: string | null; reason: string; createdAt: string; liftedAt: string | null; operator: string | null; active: boolean }>;
  reportsAgainst: Array<{ id: string; targetType: TargetType; reason: ReportReason; status: ReportStatus; createdAt: string }>;
  reportsAgainstTotal: number | null;
  reportsMade: number | null;
  posts: { total: number | null; hidden: number | null; limited: number | null };
  history: ModerationEntry[];
};

export type AccountResult = { state: "ready"; account: AccountRecord } | { state: "not_found" } | NotReady;

export async function getAccountRecord(userId: string): Promise<AccountResult> {
  await requireAdmin("explore.view");
  if (!isUuid(userId)) return { state: "not_found" };
  const base = await ready();
  if (!("admin" in base)) return base;
  const { admin } = base;
  const id = userId.toLowerCase();
  const [user, profile, sanctions, against, made, posts, hidden, limited, history] = await Promise.all([
    admin.auth.admin.getUserById(id),
    admin.from("social_profiles").select("username,display_name,bio,avatar_path,is_private,created_at,birth_date_added_at").eq("user_id", id).maybeSingle(),
    admin.from("social_member_sanctions").select("id,kind,until,reason_code,created_at,lifted_at,created_by_operator").eq("user_id", id).order("created_at", { ascending: false }).limit(30),
    admin.from("social_reports").select("id,target_type,reason,status,created_at", { count: "exact" }).eq("target_user_id", id).order("created_at", { ascending: false }).limit(20),
    admin.from("social_reports").select("id", { count: "exact", head: true }).eq("user_id", id),
    admin.from("social_posts").select("id", { count: "exact", head: true }).eq("user_id", id),
    admin.from("social_posts").select("id", { count: "exact", head: true }).eq("user_id", id).eq("moderation_state", "hidden"),
    admin.from("social_posts").select("id", { count: "exact", head: true }).eq("user_id", id).eq("moderation_state", "limited"),
    moderationHistory(admin, { userId: id }),
  ]);
  // The login may be gone while rows wait for their cascade; then the record shows what Explore still has.
  if ((user.error || !user.data?.user) && !profile.data) return { state: "not_found" };
  for (const [scope, result] of [["profile", profile], ["sanctions", sanctions], ["reports", against]] as const) {
    if (result.error) {
      logServerError(`data.explore_account_${scope}`, result.error);
      return { state: "query_failed" };
    }
  }
  const sanctionRows = (sanctions.data ?? []) as Row[];
  const operators = await usernamesFor(sanctionRows.map((row) => row.created_by_operator as string | null));
  const p = profile.data as Row | null;
  return {
    state: "ready",
    account: {
      userId: id,
      profile: p ? {
        username: String(p.username), displayName: String(p.display_name), bio: String(p.bio ?? ""), avatarPath: text(p.avatar_path),
        isPrivate: p.is_private === true, createdAt: String(p.created_at), birthDateAddedAt: text(p.birth_date_added_at),
      } : null,
      sanctions: sanctionRows.map((row) => ({
        id: String(row.id), kind: row.kind as SanctionKind, until: text(row.until), reason: String(row.reason_code), createdAt: String(row.created_at),
        liftedAt: text(row.lifted_at), operator: row.created_by_operator ? (operators.get(String(row.created_by_operator)) ?? null) : null,
        active: sanctionActive({ liftedAt: text(row.lifted_at), until: text(row.until) }),
      })),
      reportsAgainst: ((against.data ?? []) as Row[]).flatMap((row) => (isTargetType(row.target_type) && isReason(row.reason) && isReportStatus(row.status)
        ? [{ id: String(row.id), targetType: row.target_type, reason: row.reason, status: row.status, createdAt: String(row.created_at) }] : [])),
      reportsAgainstTotal: against.count ?? null,
      reportsMade: made.error ? null : (made.count ?? null),
      posts: { total: posts.error ? null : (posts.count ?? null), hidden: hidden.error ? null : (hidden.count ?? null), limited: limited.error ? null : (limited.count ?? null) },
      history,
    },
  };
}

// ----------------------------------------------------------------------------------------------------------- Communities

export type CommunityRow = {
  id: string; slug: string; name: string; description: string; visibility: "public" | "private"; coverPath: string | null;
  moderationState: ContentState; createdAt: string; members: number | null; pending: number | null; moderators: number | null;
};

function toCommunity(row: Row, counts: Map<string, { members: number; pending: number; moderators: number }> | null): CommunityRow {
  const state = row.moderation_state;
  const tally = counts?.get(String(row.id));
  return {
    id: String(row.id), slug: String(row.slug), name: String(row.name), description: String(row.description ?? ""),
    visibility: row.visibility === "private" ? "private" : "public", coverPath: text(row.cover_path),
    moderationState: state === "limited" || state === "hidden" ? state : "visible", createdAt: String(row.created_at),
    members: counts ? (tally?.members ?? 0) : null, pending: counts ? (tally?.pending ?? 0) : null, moderators: counts ? (tally?.moderators ?? 0) : null,
  };
}

async function memberCounts(admin: AdminClient, ids: string[]): Promise<Map<string, { members: number; pending: number; moderators: number }> | null> {
  const counts = new Map<string, { members: number; pending: number; moderators: number }>();
  if (!ids.length) return counts;
  const { data, error } = await admin.from("social_community_members").select("community_id,role,status").in("community_id", ids).limit(20000);
  if (error) {
    logServerError("data.explore_member_counts", error);
    return null;
  }
  for (const row of (data ?? []) as Row[]) {
    const key = String(row.community_id);
    const tally = counts.get(key) ?? { members: 0, pending: 0, moderators: 0 };
    if (row.status === "pending") tally.pending += 1;
    else {
      tally.members += 1;
      if (row.role === "moderator" || row.role === "owner") tally.moderators += 1;
    }
    counts.set(key, tally);
  }
  return counts;
}

const COMMUNITY_COLUMNS = "id,slug,name,description,visibility,cover_path,moderation_state,created_at";

export async function listCommunities(): Promise<{ state: "ready"; rows: CommunityRow[] } | NotReady> {
  await requireAdmin("explore.view");
  const base = await ready();
  if (!("admin" in base)) return base;
  const { data, error } = await base.admin.from("social_communities").select(COMMUNITY_COLUMNS).order("name").limit(500);
  if (error) {
    logServerError("data.explore_communities", error);
    return { state: "query_failed" };
  }
  const rows = (data ?? []) as Row[];
  const counts = await memberCounts(base.admin, rows.map((row) => String(row.id)));
  return { state: "ready", rows: rows.map((row) => toCommunity(row, counts)) };
}

export type CommunityDetail = CommunityRow & { moderatorList: Array<{ userId: string; username: string | null; joinedAt: string }> };

export async function getCommunity(id: string): Promise<{ state: "ready"; community: CommunityDetail } | { state: "not_found" } | NotReady> {
  await requireAdmin("explore.view");
  if (!isUuid(id)) return { state: "not_found" };
  const base = await ready();
  if (!("admin" in base)) return base;
  const { admin } = base;
  const [community, moderators] = await Promise.all([
    admin.from("social_communities").select(COMMUNITY_COLUMNS).eq("id", id).maybeSingle(),
    admin.from("social_community_members").select("user_id,joined_at").eq("community_id", id).eq("status", "accepted").in("role", ["moderator", "owner"]).order("joined_at").limit(50),
  ]);
  if (community.error || moderators.error) {
    logServerError("data.explore_community", community.error ?? moderators.error);
    return { state: "query_failed" };
  }
  if (!community.data) return { state: "not_found" };
  const modRows = (moderators.data ?? []) as Row[];
  const [counts, names] = await Promise.all([memberCounts(admin, [id]), exploreNames(admin, modRows.map((row) => row.user_id as string))]);
  return {
    state: "ready",
    community: {
      ...toCommunity(community.data as Row, counts),
      moderatorList: modRows.map((row) => ({ userId: String(row.user_id), username: names.get(String(row.user_id))?.username ?? null, joinedAt: String(row.joined_at) })),
    },
  };
}

/** The account id of an Explore username, for appointing a moderator; null when nobody has it. */
export async function userIdForUsername(username: string): Promise<string | null> {
  await requireAdmin("explore.moderate");
  const admin = createAdminSupabase();
  const name = username.trim().replace(/^@/, "").toLowerCase();
  if (!admin || !/^[a-z0-9._]{3,30}$/.test(name)) return null;
  const { data, error } = await admin.from("social_profiles").select("user_id").eq("username", name).maybeSingle();
  if (error) {
    logServerError("data.explore_username", error);
    return null;
  }
  return data ? String((data as Row).user_id) : null;
}

// ------------------------------------------------------------------------------------------------------------ Challenges

export type ChallengeRow = {
  id: string; kind: ChallengeKind; title: string; metric: ChallengeMetric; sport: string | null; target: number | null;
  startsAt: string; endsAt: string; closedAt: string | null; communityId: string | null; communityName: string | null;
  templateId: string | null; participants: number | null;
};
export type TemplateRow = { id: string; kind: ChallengeKind; title: string; metric: ChallengeMetric; sport: string | null; target: number | null; active: boolean };

export type ChallengesResult =
  | { state: "ready"; open: ChallengeRow[]; closed: ChallengeRow[]; templates: TemplateRow[]; communities: Array<{ id: string; name: string }> }
  | NotReady;

export async function listChallenges(): Promise<ChallengesResult> {
  await requireAdmin("explore.view");
  const base = await ready();
  if (!("admin" in base)) return base;
  const { admin } = base;
  const columns = "id,kind,title,metric,sport,target,starts_at,ends_at,closed_at,community_id,template_id";
  const [open, closed, templates, communities] = await Promise.all([
    admin.from("social_challenges").select(columns).is("closed_at", null).order("starts_at").limit(100),
    admin.from("social_challenges").select(columns).not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(20),
    admin.from("social_challenge_templates").select("id,kind,title,metric,sport,target,active").order("created_at").limit(100),
    admin.from("social_communities").select("id,name").order("name").limit(500),
  ]);
  const failed = open.error ?? closed.error ?? templates.error ?? communities.error;
  if (failed) {
    logServerError("data.explore_challenges", failed);
    return { state: "query_failed" };
  }
  const challengeRows = [...((open.data ?? []) as Row[]), ...((closed.data ?? []) as Row[])];
  const ids = challengeRows.map((row) => String(row.id));
  const entries = ids.length ? await admin.from("social_challenge_entries").select("challenge_id").in("challenge_id", ids).limit(50000) : { data: [] as Row[], error: null };
  const participants = entries.error ? null : new Map<string, number>();
  if (participants) for (const row of (entries.data ?? []) as Row[]) participants.set(String(row.challenge_id), (participants.get(String(row.challenge_id)) ?? 0) + 1);
  if (entries.error) logServerError("data.explore_challenge_entries", entries.error);
  const communityList = ((communities.data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name) }));
  const communityName = new Map(communityList.map((entry) => [entry.id, entry.name]));
  const toChallenge = (row: Row): ChallengeRow => ({
    id: String(row.id), kind: row.kind === "monthly" ? "monthly" : "weekly", title: String(row.title), metric: row.metric as ChallengeMetric,
    sport: text(row.sport), target: num(row.target), startsAt: String(row.starts_at), endsAt: String(row.ends_at), closedAt: text(row.closed_at),
    communityId: text(row.community_id), communityName: row.community_id ? (communityName.get(String(row.community_id)) ?? null) : null,
    templateId: text(row.template_id), participants: participants ? (participants.get(String(row.id)) ?? 0) : null,
  });
  return {
    state: "ready",
    open: ((open.data ?? []) as Row[]).map(toChallenge),
    closed: ((closed.data ?? []) as Row[]).map(toChallenge),
    templates: ((templates.data ?? []) as Row[]).map((row) => ({
      id: String(row.id), kind: row.kind === "monthly" ? "monthly" : "weekly", title: String(row.title), metric: row.metric as ChallengeMetric,
      sport: text(row.sport), target: num(row.target), active: row.active === true,
    })),
    communities: communityList,
  };
}

// ------------------------------------------------------------------------------------------------------- Free-plan meter

export type ExploreMeter = {
  measuredAt: string;
  databaseBytes: number | null;
  buckets: Array<{ bucket: string; files: number; bytes: number; unsized: number }>;
  explore: Record<string, { files: number; bytes: number; unsized: number }>;
  videoPlayBytesToday: number | null;
  caps: { socialMediaBytes: number | null; videoBytes: number | null; storyBytes: number | null; videoPlayBytesPerDay: number | null };
  trash: { files: number | null; oldest: string | null };
  hourlyJob: { status: string | null; startedAt: string | null } | null;
};

export async function getExploreMeter(): Promise<{ state: "ready"; meter: ExploreMeter } | NotReady> {
  await requireAdmin("explore.view");
  const base = await ready();
  if (!("admin" in base)) return base;
  const { data, error } = await base.admin.rpc("fitx_admin_explore_meter");
  if (error || !data || typeof data !== "object") {
    if (error && isMissingSchema(error)) return { state: "migration_pending" };
    logServerError("data.explore_meter", error);
    return { state: "query_failed" };
  }
  const m = data as Row;
  const caps = (m.caps ?? {}) as Row;
  const trash = (m.trash ?? {}) as Row;
  const job = m.hourly_job && typeof m.hourly_job === "object" ? (m.hourly_job as Row) : null;
  const kinds = (m.explore && typeof m.explore === "object" ? m.explore : {}) as Record<string, Row>;
  return {
    state: "ready",
    meter: {
      measuredAt: String(m.measured_at),
      databaseBytes: num(m.database_bytes),
      buckets: (Array.isArray(m.buckets) ? (m.buckets as Row[]) : []).map((b) => ({ bucket: String(b.bucket), files: num(b.files) ?? 0, bytes: num(b.bytes) ?? 0, unsized: num(b.unsized) ?? 0 })),
      explore: Object.fromEntries(Object.entries(kinds).map(([kind, value]) => [kind, { files: num(value.files) ?? 0, bytes: num(value.bytes) ?? 0, unsized: num(value.unsized) ?? 0 }])),
      videoPlayBytesToday: num(m.video_play_bytes_today),
      caps: {
        socialMediaBytes: num(caps.social_media_bytes), videoBytes: num(caps.video_bytes), storyBytes: num(caps.story_bytes),
        videoPlayBytesPerDay: num(caps.video_play_bytes_per_day),
      },
      trash: { files: num(trash.files), oldest: text(trash.oldest) },
      hourlyJob: job ? { status: text(job.status), startedAt: text(job.started_at) } : null,
    },
  };
}
