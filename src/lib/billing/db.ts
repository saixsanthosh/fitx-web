import "server-only";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError, isMissingFunctionError } from "@/lib/supabase/errors";
import type { BillingEvent } from "./events";
import type { BillingMode, BillingPeriod, PlanView, SubscriptionStatus } from "./types";

/**
 * Billing data access with the server-only Supabase key. Every write is a call to one of the security
 * definer functions in migration 20261118190000; the key itself may only read the billing tables.
 */

export type BillingDb = SupabaseClient;

function timeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
}

export function createBillingDb({ supabaseUrl, serverKey }: { supabaseUrl: string; serverKey: string }, timeoutMs = 8000): BillingDb {
  return createClient(supabaseUrl, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timeoutFetch(timeoutMs) },
  });
}

/** A table that does not exist yet: Postgres 42P01, PostgREST PGRST205. */
export function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

/** The billing migration is not applied (table, column or function unknown). */
export const isMissingBillingSchema = (error: unknown) =>
  isMissingTableError(error) || isMissingColumnError(error) || isMissingFunctionError(error);

export type BillingStoreFailure = "missing_schema" | "mode_mismatch" | "already_subscribed" | "rate_limited" | "conflict" | "failed";

export class BillingStoreError extends Error {
  readonly kind: BillingStoreFailure;
  readonly code: string | null;

  constructor(kind: BillingStoreFailure, code: string | null, message: string) {
    super(message);
    this.name = "BillingStoreError";
    this.kind = kind;
    this.code = code;
  }
}

export function toStoreError(error: PostgrestError | { code?: string; message?: string }, scope: string): BillingStoreError {
  const code = typeof error.code === "string" ? error.code : null;
  const message = typeof error.message === "string" ? error.message : "";
  let kind: BillingStoreFailure = "failed";
  if (isMissingBillingSchema(error)) kind = "missing_schema";
  else if (message.includes("billing_mode_mismatch")) kind = "mode_mismatch";
  else if (message.includes("billing_already_subscribed")) kind = "already_subscribed";
  else if (message.includes("billing_checkout_limit")) kind = "rate_limited";
  else if (code === "23505") kind = "conflict";
  return new BillingStoreError(kind, code, `${scope}: ${kind}${code ? ` (${code})` : ""}`);
}

// Plans -----------------------------------------------------------------------------------------

export type PlanRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  features: string[] | null;
  amount_paise: number;
  currency: string;
  billing_period: BillingPeriod;
  billing_interval: number;
  razorpay_plan_id_test: string | null;
  razorpay_plan_id_live: string | null;
  is_active: boolean;
  sort_order: number;
};

export const PLAN_COLUMNS =
  "id,code,name,description,features,amount_paise,currency,billing_period,billing_interval,razorpay_plan_id_test,razorpay_plan_id_live,is_active,sort_order";

export const providerPlanId = (plan: Pick<PlanRow, "razorpay_plan_id_test" | "razorpay_plan_id_live">, mode: BillingMode) =>
  (mode === "live" ? plan.razorpay_plan_id_live : plan.razorpay_plan_id_test) || null;

export function toPlanView(plan: PlanRow): PlanView {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    features: (plan.features ?? []).filter((feature) => typeof feature === "string" && feature.trim()).map((feature) => feature.trim()),
    amountPaise: plan.amount_paise,
    period: plan.billing_period,
    interval: plan.billing_interval,
  };
}

/** Active plans that can be bought in this mode, in the owner's order. */
export async function listSellablePlans(db: BillingDb, mode: BillingMode): Promise<PlanRow[]> {
  const { data, error } = await db
    .from("billing_plans")
    .select(PLAN_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("amount_paise", { ascending: true });
  if (error) throw toStoreError(error, "billing.plans");
  return ((data ?? []) as PlanRow[]).filter((plan) => plan.currency === "INR" && providerPlanId(plan, mode));
}

export async function findActivePlan(db: BillingDb, code: string): Promise<PlanRow | null> {
  const { data, error } = await db.from("billing_plans").select(PLAN_COLUMNS).eq("code", code).eq("is_active", true).maybeSingle();
  if (error) throw toStoreError(error, "billing.plan");
  return (data as PlanRow | null) ?? null;
}

// Subscriptions ---------------------------------------------------------------------------------

export type SubscriptionRow = {
  id: string;
  user_id: string | null;
  plan_id: string;
  mode: BillingMode;
  provider_subscription_id: string;
  provider_plan_id: string;
  status: SubscriptionStatus;
  paid_until: string | null;
  charge_at: string | null;
  cancel_requested_at: string | null;
  abandoned_at: string | null;
  created_at: string;
};

export const SUBSCRIPTION_COLUMNS =
  "id,user_id,plan_id,mode,provider_subscription_id,provider_plan_id,status,paid_until,charge_at,cancel_requested_at,abandoned_at,created_at";

export async function listUserSubscriptions(db: BillingDb, userId: string, mode: BillingMode): Promise<SubscriptionRow[]> {
  const { data, error } = await db
    .from("billing_subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId)
    .eq("mode", mode)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw toStoreError(error, "billing.subscriptions");
  return (data ?? []) as SubscriptionRow[];
}

export async function recordCheckout(
  db: BillingDb,
  args: { userId: string; planId: string; mode: BillingMode; providerSubscriptionId: string; providerPlanId: string; totalCount: number },
): Promise<string> {
  const { data, error } = await db.rpc("billing_record_checkout", {
    p_user_id: args.userId,
    p_plan_id: args.planId,
    p_mode: args.mode,
    p_provider_subscription_id: args.providerSubscriptionId,
    p_provider_plan_id: args.providerPlanId,
    p_total_count: args.totalCount,
  });
  if (error) throw toStoreError(error, "billing.record_checkout");
  if (typeof data !== "string") throw new BillingStoreError("failed", null, "billing.record_checkout: no id returned");
  return data;
}

// Events ----------------------------------------------------------------------------------------

export type ApplyResult = {
  outcome: "applied" | "ignored" | "duplicate";
  detail: string | null;
  subscriptionId: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
  paymentCreated: boolean;
};

export async function applyBillingEvent(db: BillingDb, event: BillingEvent): Promise<ApplyResult> {
  const { data, error } = await db.rpc("billing_apply_event", { p_event: event });
  if (error) throw toStoreError(error, "billing.apply_event");
  const result = (data ?? {}) as Record<string, unknown>;
  const outcome = result.outcome;
  if (outcome !== "applied" && outcome !== "ignored" && outcome !== "duplicate") {
    throw new BillingStoreError("failed", null, "billing.apply_event: unexpected result");
  }
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    outcome,
    detail: text(result.detail),
    subscriptionId: text(result.subscription_id),
    statusBefore: text(result.status_before),
    statusAfter: text(result.status_after),
    paymentCreated: result.payment_created === true,
  };
}

// Reconciliation --------------------------------------------------------------------------------

export type ReconcileCandidate = { id: string; provider_subscription_id: string; status: SubscriptionStatus };

export async function listReconcileCandidates(db: BillingDb, mode: BillingMode, limit: number): Promise<ReconcileCandidate[]> {
  const { data, error } = await db.rpc("billing_reconcile_candidates", { p_mode: mode, p_limit: limit });
  if (error) throw toStoreError(error, "billing.reconcile_candidates");
  return (data ?? []) as ReconcileCandidate[];
}

export type KnownPayment = { provider_payment_id: string; status: string; amount_paise: number; amount_refunded_paise: number };

export async function listSubscriptionPayments(db: BillingDb, subscriptionId: string): Promise<KnownPayment[]> {
  const { data, error } = await db
    .from("billing_payments")
    .select("provider_payment_id,status,amount_paise,amount_refunded_paise")
    .eq("subscription_id", subscriptionId)
    .limit(500);
  if (error) throw toStoreError(error, "billing.subscription_payments");
  return (data ?? []) as KnownPayment[];
}

export async function recordReconciliationRun(
  db: BillingDb,
  run: { mode: BillingMode; started_at: string; subscriptions_checked: number; corrections: number; errors: number; detail: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.rpc("billing_record_reconciliation", { p_run: run });
  if (error) throw toStoreError(error, "billing.record_reconciliation");
}
