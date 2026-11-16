import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { checkoutAllowedFor, logBillingUnavailable, readBillingConfig } from "./config";
import { isMissingBillingSchema, PLAN_COLUMNS, providerPlanId, toPlanView, type PlanRow } from "./db";
import {
  isPaymentStatus,
  isRefundStatus,
  isSubscriptionStatus,
  LIVE_SUBSCRIPTION_STATUSES,
  type BillingMode,
  type BillingPeriod,
  type PaymentView,
  type PlanView,
  type RefundView,
  type SubscriptionView,
} from "./types";

export type SubscriptionPageModel =
  | { state: "signed_out" }
  /** The billing tables do not exist yet (migration not applied). */
  | { state: "not_installed" }
  | { state: "error" }
  | {
      state: "ready";
      /** Billing is configured and this account may start a checkout. */
      checkoutOpen: boolean;
      mode: BillingMode | null;
      plans: PlanView[];
      current: SubscriptionView | null;
      premium: boolean;
      payments: PaymentView[];
      refunds: RefundView[];
      email: string | null;
    };

type PlanJoin = { name: string; amount_paise: number; billing_period: BillingPeriod; billing_interval: number } | null;
type SubscriptionRead = {
  id: string;
  plan_id: string;
  mode: BillingMode;
  status: string;
  paid_until: string | null;
  charge_at: string | null;
  cancel_requested_at: string | null;
  abandoned_at: string | null;
  created_at: string;
  billing_plans: PlanJoin | PlanJoin[];
};

function toSubscriptionView(row: SubscriptionRead): SubscriptionView | null {
  if (!isSubscriptionStatus(row.status)) return null;
  const plan = Array.isArray(row.billing_plans) ? row.billing_plans[0] ?? null : row.billing_plans;
  return {
    id: row.id,
    planId: row.plan_id,
    planName: plan?.name ?? null,
    amountPaise: plan?.amount_paise ?? null,
    period: plan?.billing_period ?? null,
    interval: plan?.billing_interval ?? null,
    status: row.status,
    mode: row.mode,
    paidUntil: row.paid_until,
    chargeAt: row.charge_at,
    cancelRequestedAt: row.cancel_requested_at,
    createdAt: row.created_at,
  };
}

const stillPaid = (subscription: SubscriptionView, now: number) =>
  Boolean(subscription.paidUntil) && Date.parse(subscription.paidUntil!) > now;

/**
 * The subscription the page talks about: one Razorpay is still billing, else one whose paid period
 * has not ended, else the most recent one that was ever paid or used. Unpaid checkouts are skipped.
 */
export function pickCurrentSubscription(subscriptions: SubscriptionView[], now = Date.now()): SubscriptionView | null {
  const used = subscriptions.filter((subscription) => subscription.status !== "created");
  return (
    used.find((subscription) => LIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) ??
    used.find((subscription) => stillPaid(subscription, now)) ??
    used[0] ??
    null
  );
}

async function readOwnBilling(supabase: SupabaseClient, user: User) {
  const [subscriptions, payments, refunds, premium, plans] = await Promise.all([
    supabase
      .from("billing_subscriptions")
      .select("id,plan_id,mode,status,paid_until,charge_at,cancel_requested_at,abandoned_at,created_at,billing_plans(name,amount_paise,billing_period,billing_interval)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("billing_payments")
      .select("id,amount_paise,currency,status,method,amount_refunded_paise,error_description,provider_created_at,created_at,period_start,period_end,mode")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(24),
    supabase
      .from("billing_refunds")
      .select("id,amount_paise,currency,status,provider_created_at,created_at,processed_at,mode")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(24),
    supabase.rpc("has_premium", { p_user_id: user.id }),
    supabase.from("billing_plans").select(PLAN_COLUMNS).eq("is_active", true).order("sort_order").order("amount_paise"),
  ]);
  return { subscriptions, payments, refunds, premium, plans };
}

export async function loadSubscriptionPage(): Promise<SubscriptionPageModel> {
  const supabase = await createClient();
  if (!supabase) return { state: "not_installed" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { state: "signed_out" };

  const config = readBillingConfig();
  if (!config.ok) logBillingUnavailable(config.reason);
  const mode: BillingMode | null = config.ok ? config.config.mode : null;
  const checkoutOpen = config.ok && checkoutAllowedFor(config.config, user.email);

  const reads = await readOwnBilling(supabase, user);
  const failures = [reads.subscriptions.error, reads.payments.error, reads.refunds.error, reads.premium.error, reads.plans.error].filter(Boolean);
  if (failures.some(isMissingBillingSchema)) return { state: "not_installed" };
  if (failures.length) {
    console.error(`[fitx-billing] subscription page: ${failures.map((failure) => failure?.code ?? "error").join(", ")}`);
    return { state: "error" };
  }

  const subscriptions = ((reads.subscriptions.data ?? []) as SubscriptionRead[])
    .filter((row) => !(row.status === "created" && row.abandoned_at))
    .map(toSubscriptionView)
    .filter((row): row is SubscriptionView => row !== null);
  const sameMode = mode ? subscriptions.filter((subscription) => subscription.mode === mode) : subscriptions;

  const payments: PaymentView[] = ((reads.payments.data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    if (!isPaymentStatus(row.status)) return [];
    return [
      {
        id: String(row.id),
        amountPaise: Number(row.amount_paise),
        currency: String(row.currency),
        status: row.status,
        method: typeof row.method === "string" ? row.method : null,
        refundedPaise: Number(row.amount_refunded_paise ?? 0),
        failureReason: typeof row.error_description === "string" ? row.error_description : null,
        at: String(row.provider_created_at ?? row.created_at),
        periodStart: typeof row.period_start === "string" ? row.period_start : null,
        periodEnd: typeof row.period_end === "string" ? row.period_end : null,
        mode: row.mode === "live" ? "live" : "test",
      },
    ];
  });
  const refunds: RefundView[] = ((reads.refunds.data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    if (!isRefundStatus(row.status)) return [];
    return [
      {
        id: String(row.id),
        amountPaise: Number(row.amount_paise),
        currency: String(row.currency),
        status: row.status,
        at: String(row.provider_created_at ?? row.created_at),
        processedAt: typeof row.processed_at === "string" ? row.processed_at : null,
        mode: row.mode === "live" ? "live" : "test",
      },
    ];
  });

  const plans = checkoutOpen && mode
    ? ((reads.plans.data ?? []) as PlanRow[]).filter((plan) => plan.currency === "INR" && providerPlanId(plan, mode)).map(toPlanView)
    : [];

  return {
    state: "ready",
    checkoutOpen: checkoutOpen && plans.length > 0,
    mode,
    plans,
    current: pickCurrentSubscription(sameMode),
    premium: reads.premium.data === true,
    payments,
    refunds,
    email: user.email ?? null,
  };
}
