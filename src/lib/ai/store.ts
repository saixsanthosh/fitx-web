import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError, isMissingFunctionError } from "@/lib/supabase/errors";
import type { SafetyCaution, SafetyStopTopic } from "./safety";
import type { AiMessage, CoachActionView, CoachMessageData, CoachMessageView, CoachQuota, CoachSwap, CoachThreadSummary } from "./types";
import { isRecord } from "./validate";

/**
 * Reads and writes the coach tables with the member's own session, so row-level security applies to
 * every query. Before migration 20261118150000 is applied the tables do not exist: every function
 * then throws CoachStoreError("not_available") and the page says the coach is not available yet.
 */

// The app has no generated database types; queries are checked by hand and by tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>;

export class CoachStoreError extends Error {
  readonly code: "not_available" | "not_found" | "invalid" | "failed";
  constructor(code: CoachStoreError["code"], message: string) {
    super(message);
    this.name = "CoachStoreError";
    this.code = code;
  }
}

/** A table or function from the coach migration is missing (Postgres 42P01, PostgREST PGRST205 / PGRST202). */
export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "PGRST205" || isMissingFunctionError(error) || isMissingColumnError(error);
}

function fail(error: unknown, what: string): never {
  if (isMissingSchemaError(error)) throw new CoachStoreError("not_available", `${what}: coach tables missing`);
  const code = (error as { code?: unknown } | null)?.code;
  throw new CoachStoreError(code === "P0002" ? "not_found" : code === "22023" || code === "23514" ? "invalid" : "failed", `${what} failed (${String(code ?? "unknown")})`);
}

/** `updatedAt`: when the consent was last saved, which is when "Use my FITX data" was last switched. */
export type Consent = { shareData: boolean; consentedAt: string; updatedAt: string | null };

export async function getConsent(db: Db, userId: string): Promise<Consent | null> {
  const { data, error } = await db.from("ai_coach_consents").select("share_personal_data, consented_at, updated_at").eq("user_id", userId).maybeSingle();
  if (error) fail(error, "read consent");
  return data ? { shareData: data.share_personal_data !== false, consentedAt: String(data.consented_at), updatedAt: data.updated_at ? String(data.updated_at) : null } : null;
}

export async function saveConsent(db: Db, userId: string, shareData: boolean) {
  const now = new Date().toISOString();
  const { error } = await db
    .from("ai_coach_consents")
    .upsert({ user_id: userId, consent_version: 1, share_personal_data: shareData, consented_at: now, updated_at: now }, { onConflict: "user_id" });
  if (error) fail(error, "save consent");
}

export async function updateDataSharing(db: Db, userId: string, shareData: boolean) {
  const { data, error } = await db.from("ai_coach_consents").update({ share_personal_data: shareData, updated_at: new Date().toISOString() }).eq("user_id", userId).select("user_id");
  if (error) fail(error, "update consent");
  if (!Array.isArray(data) || !data.length) throw new CoachStoreError("not_found", "no consent to update");
}

export async function withdrawConsent(db: Db, userId: string) {
  const { error } = await db.from("ai_coach_consents").delete().eq("user_id", userId);
  if (error) fail(error, "withdraw consent");
}

export type QuotaTicket = { allowed: boolean; eventId: string | null; quota: CoachQuota };

export async function takeQuota(db: Db, kind: "chat" | "plan"): Promise<QuotaTicket> {
  const { data, error } = await db.rpc("ai_coach_take_quota", { p_kind: kind });
  if (error) fail(error, "take quota");
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new CoachStoreError("failed", "take quota returned nothing");
  return {
    allowed: row.allowed === true,
    eventId: typeof row.event_id === "string" ? row.event_id : null,
    quota: { kind, used: Number(row.used) || 0, limit: Number(row.daily_limit) || 0, resetsAt: String(row.resets_at ?? "") },
  };
}

/** Hands a request back when no AI service answered. Best effort: a failure only means it counts. */
export async function releaseQuota(db: Db, eventId: string | null) {
  if (!eventId) return;
  try {
    await db.rpc("ai_coach_release_quota", { p_event_id: eventId });
  } catch {
    // Counting one unanswered request is better than failing the response over it.
  }
}

export async function quotaStatus(db: Db): Promise<CoachQuota[]> {
  const { data, error } = await db.rpc("ai_coach_quota_status");
  if (error) fail(error, "quota status");
  return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
    kind: row.quota_kind === "plan" ? "plan" : "chat",
    used: Number(row.used) || 0,
    limit: Number(row.daily_limit) || 0,
    resetsAt: String(row.resets_at ?? ""),
  }));
}

export async function createThread(db: Db, userId: string, title: string): Promise<CoachThreadSummary> {
  const { data, error } = await db.from("ai_coach_threads").insert({ user_id: userId, title }).select("id, title, updated_at").single();
  if (error) fail(error, "create thread");
  return { id: data.id, title: data.title, updatedAt: data.updated_at };
}

export async function getThread(db: Db, userId: string, threadId: string): Promise<CoachThreadSummary | null> {
  const { data, error } = await db.from("ai_coach_threads").select("id, title, updated_at").eq("user_id", userId).eq("id", threadId).maybeSingle();
  if (error) fail(error, "read thread");
  return data ? { id: data.id, title: data.title, updatedAt: data.updated_at } : null;
}

export async function touchThread(db: Db, userId: string, threadId: string) {
  await db.from("ai_coach_threads").update({ updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", threadId);
}

export async function deleteThread(db: Db, userId: string, threadId: string) {
  const { data, error } = await db.from("ai_coach_threads").delete().eq("user_id", userId).eq("id", threadId).select("id");
  if (error) fail(error, "delete thread");
  if (!Array.isArray(data) || !data.length) throw new CoachStoreError("not_found", "thread not found");
}

export async function listThreads(db: Db, userId: string, limit = 30): Promise<CoachThreadSummary[]> {
  const { data, error } = await db.from("ai_coach_threads").select("id, title, updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(limit);
  if (error) fail(error, "list threads");
  return (data ?? []).map((row: Record<string, string>) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }));
}

export type NewMessage = {
  id?: string;
  threadId: string;
  role: CoachMessageView["role"];
  task: CoachMessageView["task"];
  content: string;
  data?: CoachMessageData | null;
  provider?: string | null;
  model?: string | null;
};

export async function insertMessage(db: Db, userId: string, message: NewMessage): Promise<CoachMessageView> {
  const { data, error } = await db
    .from("ai_coach_messages")
    .insert({
      ...(message.id ? { id: message.id } : {}),
      user_id: userId,
      thread_id: message.threadId,
      role: message.role,
      task: message.task,
      content: message.content,
      data: message.data ?? null,
      provider: message.provider ?? null,
      model: message.model ?? null,
    })
    .select("id, role, task, content, data, provider, created_at")
    .single();
  if (error) fail(error, "save message");
  return toMessageView(data);
}

export async function deleteMessage(db: Db, userId: string, messageId: string) {
  await db.from("ai_coach_messages").delete().eq("user_id", userId).eq("id", messageId);
}

/**
 * The last few turns, oldest first, as model input. Safety notes are FITX's own text, not conversation,
 * and are left out. A member message the safety screen stopped never goes to a model, now or later: it is
 * marked `safetyStop`, and any member message answered by a FITX safety note is left out as well.
 *
 * With `since` (a request that does not share the member's FITX data), only messages created after it are
 * included: replies the coach wrote from the member's data before "Use my FITX data" was turned off are not
 * sent again. `keep`, the message being answered, is always included, whatever the clocks say.
 */
export async function recentTurns(db: Db, userId: string, threadId: string, options: { since?: string | null; keep?: string | null; limit?: number } = {}): Promise<AiMessage[]> {
  const { since = null, keep = null, limit = 12 } = options;
  const { data, error } = await db
    .from("ai_coach_messages")
    .select("id, role, content, data, created_at")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit + 6);
  if (error) fail(error, "read history");
  const rows = (data ?? []) as Array<{ id: string; role: string; content: string; data: unknown; created_at: string }>;
  const after = since ? Date.parse(since) : Number.NaN;
  const filtered = Number.isFinite(after);
  let budget = 8000;
  const turns: AiMessage[] = [];
  for (let index = 0; index < rows.length && turns.length < limit; index += 1) {
    const row = rows[index];
    if (row.role !== "user" && row.role !== "assistant") continue;
    if (row.role === "user") {
      const stopped = isRecord(row.data) && typeof row.data.safetyStop === "string";
      // Rows are newest first, so the reply to this message is the row before it.
      const answeredBySafetyNote = rows[index - 1]?.role === "safety";
      if (stopped || answeredBySafetyNote) continue;
    }
    if (filtered && row.id !== keep && !(Date.parse(row.created_at) > after)) continue;
    const content = row.content.length > 1500 ? `${row.content.slice(0, 1500)}…` : row.content;
    budget -= content.length;
    if (budget < 0) break;
    turns.unshift({ role: row.role, content });
  }
  // A reply saved after the switch to a question asked before it was still written from the member's data.
  if (filtered) while (turns.length && turns[0].role === "assistant") turns.shift();
  return turns;
}

/** Whether FITX showed this member a safety note on `topic` in the last `days` days (in any conversation). */
export async function hasRecentSafetyNote(db: Db, userId: string, topic: SafetyStopTopic, days: number): Promise<boolean> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db
    .from("ai_coach_messages")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "safety")
    .eq("data->>safety", topic)
    .gte("created_at", since)
    .limit(1);
  if (error) fail(error, "read safety notes");
  return Array.isArray(data) && data.length > 0;
}

/** Health topics (pregnancy, a medical condition…) the member raised in this conversation's recent messages. */
export async function recentCautions(db: Db, userId: string, threadId: string, limit = 30): Promise<SafetyCaution[]> {
  const { data, error } = await db
    .from("ai_coach_messages")
    .select("data")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail(error, "read history");
  const found = new Set<SafetyCaution>();
  for (const row of (data ?? []) as Array<{ data: unknown }>) {
    const cautions = isRecord(row.data) && Array.isArray(row.data.cautions) ? row.data.cautions : [];
    for (const caution of cautions) if (typeof caution === "string") found.add(caution as SafetyCaution);
  }
  return [...found];
}

export type NewAction = { id: string; kind: CoachActionView["kind"]; payload: Record<string, unknown> };

export async function insertActions(db: Db, userId: string, threadId: string, messageId: string, actions: NewAction[]) {
  if (!actions.length) return;
  const { error } = await db
    .from("ai_coach_actions")
    .insert(actions.map((action) => ({ id: action.id, user_id: userId, thread_id: threadId, message_id: messageId, kind: action.kind, payload: action.payload })));
  if (error) fail(error, "save proposals");
}

export async function getAction(db: Db, userId: string, actionId: string) {
  const { data, error } = await db.from("ai_coach_actions").select("id, thread_id, message_id, kind, status, payload").eq("user_id", userId).eq("id", actionId).maybeSingle();
  if (error) fail(error, "read proposal");
  return data as { id: string; thread_id: string; message_id: string; kind: CoachActionView["kind"]; status: CoachActionView["status"]; payload: Record<string, unknown> } | null;
}

export async function applyAction(db: Db, actionId: string): Promise<{ kind: string; refId: string; already: boolean }> {
  const { data, error } = await db.rpc("ai_coach_apply_action", { p_action_id: actionId });
  if (error) fail(error, "apply proposal");
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || typeof row.ref_id !== "string") throw new CoachStoreError("failed", "apply returned nothing");
  return { kind: String(row.action_kind), refId: row.ref_id, already: row.already_applied === true };
}

export async function dismissAction(db: Db, userId: string, actionId: string) {
  const { data, error } = await db.from("ai_coach_actions").update({ status: "dismissed" }).eq("user_id", userId).eq("id", actionId).eq("status", "proposed").select("id");
  if (error) fail(error, "dismiss proposal");
  if (!Array.isArray(data) || !data.length) throw new CoachStoreError("not_found", "proposal not found or already used");
}

export async function loadThreadView(db: Db, userId: string, threadId: string): Promise<{ thread: CoachThreadSummary; messages: CoachMessageView[]; actions: CoachActionView[] } | null> {
  const thread = await getThread(db, userId, threadId);
  if (!thread) return null;
  // The newest 200 messages (a long conversation shows its latest turns), then their proposals.
  const messages = await db.from("ai_coach_messages").select("id, role, task, content, data, provider, created_at").eq("user_id", userId).eq("thread_id", threadId).order("created_at", { ascending: false }).limit(200);
  if (messages.error) fail(messages.error, "read messages");
  const rows = ((messages.data ?? []) as Array<Record<string, unknown>>).reverse();
  const ids = rows.map((row) => String(row.id));
  const actions = ids.length
    ? await db.from("ai_coach_actions").select("id, message_id, kind, status, payload").eq("user_id", userId).in("message_id", ids).order("created_at", { ascending: true }).limit(2000)
    : { data: [], error: null };
  if (actions.error) fail(actions.error, "read proposals");
  return { thread, messages: rows.map(toMessageView), actions: (actions.data ?? []).map(toActionView) };
}

export async function deleteAllCoachData(db: Db): Promise<{ threads: number; consentWithdrawn: boolean }> {
  const { data, error } = await db.rpc("ai_coach_delete_my_data");
  if (error) fail(error, "delete coach data");
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return { threads: Number(row?.threads_deleted) || 0, consentWithdrawn: row?.consent_withdrawn === true };
}

function toMessageView(row: Record<string, unknown>): CoachMessageView {
  return {
    id: String(row.id),
    role: row.role === "assistant" || row.role === "safety" ? row.role : "user",
    task: row.task === "meal_plan" || row.task === "workout_plan" ? row.task : "chat",
    content: String(row.content ?? ""),
    data: isRecord(row.data) ? (row.data as CoachMessageData) : null,
    provider: typeof row.provider === "string" ? row.provider : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export function toActionView(row: Record<string, unknown>): CoachActionView {
  const payload = isRecord(row.payload) ? row.payload : {};
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    kind: row.kind === "meal" || row.kind === "workout_plan" ? row.kind : "food",
    status: row.status === "applied" || row.status === "dismissed" ? row.status : "proposed",
    swap: isRecord(payload.swap) ? (payload.swap as CoachSwap) : null,
  };
}
