import "server-only";
import type { User } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";
import { logAdminEvent, type AuditWrite } from "@/lib/audit";
import { logServerError } from "@/lib/log";
import { isAdminRole, type AdminRole } from "@/lib/roles";
import { isMissingFunction } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const PEOPLE_PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Account fields only. Profiles, workouts, meals, measurements and other health data never appear here. */
export type PersonSummary = {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  bannedUntil: string | null;
  providers: string[];
  adminRole: AdminRole | null;
};

export type PeopleResult =
  | {
      state: "ready";
      people: PersonSummary[];
      query: string;
      page: number;
      /** Total matches, when the search function is installed. */
      total: number | null;
      hasNext: boolean;
      /** False until migration 20261118180004 is applied: the list then pages through Auth without search. */
      searchAvailable: boolean;
      /** Whether this view was written to the audit log; the page says so either way. */
      viewLogged: AuditWrite;
    }
  | { state: "service_key_missing" | "query_failed" };

export type PersonDetail = PersonSummary & {
  displayName: string | null;
  hasPasswordSignIn: boolean;
  hasAuthenticator: boolean;
  adminActive: boolean | null;
};

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isSuspended(bannedUntil: string | null | undefined, now = Date.now()): boolean {
  if (!bannedUntil) return false;
  const until = Date.parse(bannedUntil);
  return Number.isFinite(until) && until > now;
}

function providersOf(user: Pick<User, "app_metadata" | "identities">): string[] {
  const fromMetadata = Array.isArray(user.app_metadata?.providers) ? (user.app_metadata.providers as unknown[]) : [];
  const fromIdentities = (user.identities ?? []).map((identity) => identity.provider);
  return [...new Set([...fromMetadata, ...fromIdentities].filter((value): value is string => typeof value === "string"))];
}

function summaryFromAuthUser(user: User): PersonSummary {
  return {
    id: user.id,
    email: user.email ?? null,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    bannedUntil: user.banned_until ?? null,
    providers: providersOf(user),
    adminRole: null,
  };
}

export async function searchPeople(rawQuery: string, rawPage: number): Promise<PeopleResult> {
  const { user: actor } = await requireAdmin("people.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const query = rawQuery.trim().slice(0, 120);
  const page = Number.isInteger(rawPage) ? Math.min(Math.max(rawPage, 1), 1000) : 1;

  const { data, error } = await admin.rpc("fitx_admin_search_users", {
    p_query: query || null,
    p_limit: PEOPLE_PAGE_SIZE,
    p_offset: (page - 1) * PEOPLE_PAGE_SIZE,
  });

  let result: Omit<Extract<PeopleResult, { state: "ready" }>, "viewLogged">;
  if (!error) {
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const people = rows.map((row) => ({
      id: String(row.user_id),
      email: typeof row.email === "string" ? row.email : null,
      createdAt: String(row.created_at),
      lastSignInAt: typeof row.last_sign_in_at === "string" ? row.last_sign_in_at : null,
      emailConfirmedAt: typeof row.email_confirmed_at === "string" ? row.email_confirmed_at : null,
      bannedUntil: typeof row.banned_until === "string" ? row.banned_until : null,
      providers: Array.isArray(row.providers) ? row.providers.filter((value): value is string => typeof value === "string") : [],
      adminRole: isAdminRole(row.admin_role) ? row.admin_role : null,
    }));
    const total = rows.length ? Number(rows[0].total_count) : 0;
    result = {
      state: "ready",
      people,
      query,
      page,
      total: Number.isFinite(total) ? total : null,
      hasNext: Number.isFinite(total) && page * PEOPLE_PAGE_SIZE < total,
      searchAvailable: true,
    };
  } else if (isMissingFunction(error)) {
    // Until the People migration is applied: page through Auth accounts, newest page order as Auth returns it.
    const listed = await admin.auth.admin.listUsers({ page, perPage: PEOPLE_PAGE_SIZE });
    if (listed.error) {
      logServerError("data.list_users", listed.error);
      return { state: "query_failed" };
    }
    result = {
      state: "ready",
      people: listed.data.users.map(summaryFromAuthUser).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      query,
      page,
      total: null,
      hasNext: listed.data.users.length === PEOPLE_PAGE_SIZE,
      searchAvailable: false,
    };
  } else {
    logServerError("data.search_users", error);
    return { state: "query_failed" };
  }

  const viewLogged = await logAdminEvent({
    actorId: actor.id,
    action: "users_listed",
    resourceType: "user",
    details: { page, searched: Boolean(query), results: result.people.length },
  });
  return { ...result, viewLogged };
}

export type PersonResult = { state: "ready"; person: PersonDetail; viewLogged: AuditWrite } | { state: "not_found" | "service_key_missing" | "query_failed" };

export async function getPerson(id: string): Promise<PersonResult> {
  const { user: actor } = await requireAdmin("people.view");
  if (!isUuid(id)) return { state: "not_found" };
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data.user) {
    if (error && error.status !== 404) logServerError("data.get_user", error);
    return { state: error && error.status !== 404 ? "query_failed" : "not_found" };
  }
  const user = data.user;
  const { data: member, error: memberError } = await admin
    .from("fitx_admin_members")
    .select("role,is_active")
    .eq("user_id", id)
    .maybeSingle();
  if (memberError) logServerError("data.get_user_membership", memberError);

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName = [metadata.full_name, metadata.name].find((value): value is string => typeof value === "string" && value.trim() !== "") ?? null;
  const summary = summaryFromAuthUser(user);
  const person: PersonDetail = {
    ...summary,
    adminRole: member && isAdminRole(member.role) ? member.role : null,
    adminActive: member ? Boolean(member.is_active) : null,
    displayName,
    hasPasswordSignIn: summary.providers.includes("email"),
    hasAuthenticator: (user.factors ?? []).some((factor) => factor.status === "verified"),
  };

  const viewLogged = await logAdminEvent({ actorId: actor.id, action: "user_viewed", resourceType: "user", resourceId: id });
  return { state: "ready", person, viewLogged };
}
