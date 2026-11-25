import "server-only";
import type { User } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";
import { logAdminEvent, type AuditWrite } from "@/lib/audit";
import { logServerError } from "@/lib/log";
import { isAdminRole, type AdminRole } from "@/lib/roles";
import { isMissingFunction, isMissingTable } from "@/lib/schema";
import { trainingAnswers, type TrainingAnswers } from "@/lib/training-answers";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalisePeopleQuery, type PeopleFilters } from "@/components/users/people-filters";

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
  /** From Auth, when the account has one (phone sign-in). */
  phone?: string | null;
  /** The name from sign-in (Google or the sign-up form). */
  displayName?: string | null;
  /** The latest live Razorpay subscription's status; null when there is none. */
  subscriptionStatus?: string | null;
  /** Premium access now; null when it could not be read (shown as an en dash, never as Free). */
  premium?: boolean | null;
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
      /** False until migration 20261121100033 is applied: status, method and plan filters wait for it. */
      filtersAvailable: boolean;
      /** Whether this view was written to the audit log; the page says so either way. */
      viewLogged: AuditWrite;
    }
  | { state: "service_key_missing" | "query_failed" };

export type PersonIdentity = { provider: string; createdAt: string | null; lastSignInAt: string | null };

/** The profile summary Admin may show: no body, meal or workout data. null when it could not be read. */
export type ProfileSummary = { name: string | null; goal: string | null; setUp: boolean | null; profileCreatedAt: string | null } & TrainingAnswers;


export type SubscriptionSummary = { status: string; mode: string; createdAt: string; paidUntil: string | null };

export type PersonDetail = PersonSummary & {
  displayName: string | null;
  phone: string | null;
  phoneConfirmedAt: string | null;
  hasPasswordSignIn: boolean;
  hasAuthenticator: boolean;
  adminActive: boolean | null;
  identities: PersonIdentity[];
  profile: ProfileSummary | null;
  /** Newest first, live and test; null when billing could not be read. */
  subscriptions: SubscriptionSummary[] | null;
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

/** Mirrors billing_grants_access: paid up, with three days' grace while Razorpay retries. */
export function grantsAccess(status: string, paidUntil: string | null, now = Date.now()): boolean {
  if (!paidUntil) return false;
  const until = Date.parse(paidUntil);
  if (!Number.isFinite(until)) return false;
  const grace = status === "active" || status === "pending" ? 3 * 86_400_000 : 0;
  return now < until + grace;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Accounts matching the Users filters, through fitx_admin_search_users_v2, else the older search. */
export async function searchPeopleFiltered(filters: PeopleFilters): Promise<PeopleResult> {
  const actor = await requireAdmin("people.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };
  const page = filters.page;
  const { data, error } = await admin.rpc("fitx_admin_search_users_v2", {
    p_query: filters.q || null,
    p_status: filters.status,
    p_method: filters.method,
    p_plan: filters.plan,
    p_limit: PEOPLE_PAGE_SIZE,
    p_offset: (page - 1) * PEOPLE_PAGE_SIZE,
  });
  if (error) {
    if (isMissingFunction(error)) {
      const older = await searchPeople(filters.q, page);
      return older.state === "ready" ? { ...older, filtersAvailable: false } : older;
    }
    logServerError("data.search_users_v2", error);
    return { state: "query_failed" };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const people: PersonSummary[] = rows.map((row) => ({
    id: String(row.user_id),
    email: text(row.email),
    phone: text(row.phone),
    displayName: text(row.display_name),
    createdAt: String(row.created_at),
    lastSignInAt: text(row.last_sign_in_at),
    emailConfirmedAt: text(row.email_confirmed_at) ?? text(row.phone_confirmed_at),
    bannedUntil: text(row.banned_until),
    providers: Array.isArray(row.providers) ? row.providers.filter((value): value is string => typeof value === "string") : [],
    adminRole: isAdminRole(row.admin_role) ? row.admin_role : null,
    subscriptionStatus: text(row.subscription_status),
    premium: typeof row.premium === "boolean" ? row.premium : null,
  }));
  const viewLogged = await logAdminEvent({
    actor,
    action: "users_listed",
    resourceType: "user",
    details: { page, searched: Boolean(filters.q), status: filters.status, method: filters.method, plan: filters.plan, results: people.length },
  });
  return {
    state: "ready",
    people,
    query: filters.q,
    page,
    total: Number.isFinite(total) ? total : null,
    hasNext: Number.isFinite(total) && page * PEOPLE_PAGE_SIZE < total,
    searchAvailable: true,
    filtersAvailable: true,
    viewLogged,
  };
}

export async function searchPeople(rawQuery: string, rawPage: number): Promise<PeopleResult> {
  const actor = await requireAdmin("people.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const query = normalisePeopleQuery(rawQuery);
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
      filtersAvailable: false,
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
      filtersAvailable: false,
    };
  } else {
    logServerError("data.search_users", error);
    return { state: "query_failed" };
  }

  const viewLogged = await logAdminEvent({
    actor,
    action: "users_listed",
    resourceType: "user",
    details: { page, searched: Boolean(query), results: result.people.length },
  });
  return { ...result, viewLogged };
}

export type PersonResult = { state: "ready"; person: PersonDetail; viewLogged: AuditWrite } | { state: "not_found" | "service_key_missing" | "query_failed" };

export async function getPerson(id: string): Promise<PersonResult> {
  const actor = await requireAdmin("people.view");
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
  const [profile, subscriptions] = await Promise.all([readProfileSummary(admin, id), readSubscriptions(admin, id)]);
  const person: PersonDetail = {
    ...summary,
    adminRole: member && isAdminRole(member.role) ? member.role : null,
    adminActive: member ? Boolean(member.is_active) : null,
    displayName,
    phone: user.phone ? user.phone : null,
    phoneConfirmedAt: user.phone_confirmed_at ?? null,
    hasPasswordSignIn: summary.providers.includes("email"),
    hasAuthenticator: (user.factors ?? []).some((factor) => factor.status === "verified"),
    identities: (user.identities ?? []).map((identity) => ({ provider: identity.provider, createdAt: identity.created_at ?? null, lastSignInAt: identity.last_sign_in_at ?? null })),
    profile,
    subscriptions,
    subscriptionStatus: subscriptions?.find((row) => row.mode === "live")?.status ?? null,
    premium: subscriptions ? subscriptions.some((row) => row.mode === "live" && grantsAccess(row.status, row.paidUntil)) : null,
  };

  const viewLogged = await logAdminEvent({ actor, action: "user_viewed", resourceType: "user", resourceId: id });
  return { state: "ready", person, viewLogged };
}

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;

/** Name, goal, the Workouts setup answers and whether set-up is done. Never body, meal or workout data. */
async function readProfileSummary(admin: AdminClient, id: string): Promise<ProfileSummary | null> {
  const withSetup = "primary_goal,fitness_level,workout_location,workouts_per_week,workout_setup_at";
  const [profile, firstPreferences, equipment] = await Promise.all([
    admin.from("profiles").select("name,onboarded,created_at").eq("id", id).maybeSingle(),
    admin.from("user_preferences").select(withSetup).eq("user_id", id).maybeSingle(),
    admin.from("user_equipment_profiles").select("context", { count: "exact", head: true }).eq("user_id", id),
  ]);
  // Before 20261123100020 there is no workout_setup_at: a saved equipment list alone says the setup was done.
  let preferences = firstPreferences;
  let setupColumn = true;
  if (preferences.error && isMissingTable(preferences.error)) {
    setupColumn = false;
    preferences = await admin.from("user_preferences").select("primary_goal,fitness_level,workout_location,workouts_per_week").eq("user_id", id).maybeSingle() as typeof firstPreferences;
  }
  if (profile.error || preferences.error) {
    if (profile.error && !isMissingTable(profile.error)) logServerError("data.person_profile", profile.error);
    if (preferences.error && !isMissingTable(preferences.error)) logServerError("data.person_preferences", preferences.error);
    if (profile.error && preferences.error) return null;
  }
  if (equipment.error && !isMissingTable(equipment.error)) logServerError("data.person_equipment", equipment.error);
  const p = (profile.data ?? null) as { name?: unknown; onboarded?: unknown; created_at?: unknown } | null;
  const q = (preferences.error ? null : (preferences.data ?? null)) as { primary_goal?: unknown; fitness_level?: unknown; workout_location?: unknown; workouts_per_week?: unknown; workout_setup_at?: unknown } | null;
  const hasList = equipment.error ? null : (equipment.count ?? 0) > 0;
  return {
    name: text(p?.name),
    goal: text(q?.primary_goal),
    ...trainingAnswers(q, hasList, setupColumn && !preferences.error),
    setUp: p ? Boolean(p.onboarded) : null,
    profileCreatedAt: text(p?.created_at),
  };
}

async function readSubscriptions(admin: AdminClient, id: string): Promise<SubscriptionSummary[] | null> {
  const { data, error } = await admin
    .from("billing_subscriptions")
    .select("status,mode,created_at,paid_until,abandoned_at")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    if (isMissingTable(error)) return [];
    logServerError("data.person_billing", error);
    return null;
  }
  return (data ?? [])
    .filter((row) => !row.abandoned_at)
    .map((row) => ({ status: String(row.status), mode: String(row.mode), createdAt: String(row.created_at), paidUntil: text(row.paid_until) }));
}
