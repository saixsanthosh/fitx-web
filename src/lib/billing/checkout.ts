import "server-only";
import {
  BillingStoreError,
  findActivePlan,
  listUserSubscriptions,
  providerPlanId,
  recordCheckout,
  type PlanRow,
  type SubscriptionRow,
} from "./db";
import type { BillingDeps } from "./deps";
import { normalizeSubscription } from "./events";
import { isRazorpayId } from "./ids";
import { billingCyclesForTenYears } from "./money";
import { RazorpayApiError, type RazorpayEntity } from "./razorpay";
import { verifyCheckoutSignature } from "./signature";
import { syncCheckoutSubscription } from "./sync";
import { LIVE_SUBSCRIPTION_STATUSES, type BillingMode, type BillingPeriod } from "./types";

export type CheckoutUser = { id: string; email: string | null; name: string | null };

/** What the browser needs to open Razorpay Checkout. The key id is public; nothing secret is included. */
export type CheckoutSession = {
  keyId: string;
  subscriptionId: string;
  mode: BillingMode;
  plan: { code: string; name: string; amountPaise: number; period: BillingPeriod; interval: number };
  prefill: { email?: string; name?: string };
};

export type CheckoutOutcome =
  | { kind: "ready"; session: CheckoutSession; reused: boolean }
  | { kind: "already_subscribed" }
  | { kind: "plan_not_found" }
  | { kind: "plan_unavailable" }
  | { kind: "unavailable" }
  /** The account started CHECKOUTS_PER_DAY new checkouts in the last 24 hours. */
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "provider_error"; retryable: boolean };

/** An unpaid checkout for the same plan is offered again for this long instead of creating another. */
const REUSE_OPEN_CHECKOUT_MS = 12 * 60 * 60 * 1000;

/**
 * New checkouts (new Razorpay subscriptions) one account may start per mode in any 24 hours, so a
 * script cannot flood Razorpay or the nightly reconciliation with abandoned checkouts. The same limit
 * is enforced in billing_record_checkout() for bursts of parallel requests.
 */
export const CHECKOUTS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the account has used up its new checkouts for the last 24 hours, the seconds until the oldest
 * of them no longer counts; otherwise null.
 */
export function checkoutRetryAfterSeconds(subscriptions: Pick<SubscriptionRow, "created_at">[], now: Date): number | null {
  const since = now.getTime() - DAY_MS;
  const recent = subscriptions.map((subscription) => Date.parse(subscription.created_at)).filter((at) => at > since);
  if (recent.length < CHECKOUTS_PER_DAY) return null;
  return Math.max(1, Math.ceil((Math.min(...recent) - since) / 1000));
}

export const PLAN_CODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

function logFailure(scope: string, error: unknown) {
  if (error instanceof RazorpayApiError) {
    console.error(`[fitx-billing] ${scope}: Razorpay HTTP ${error.status}${error.code ? ` ${error.code}` : ""}`);
  } else if (error instanceof BillingStoreError) {
    console.error(`[fitx-billing] ${scope}: ${error.message}`);
  } else {
    console.error(`[fitx-billing] ${scope}: ${error instanceof Error ? error.name : "unknown error"}`);
  }
}

/** Returns why a Razorpay plan does not charge what the FITX plan row shows, or null when they agree. */
export function planMismatch(plan: PlanRow, remote: RazorpayEntity, expectedId: string): string | null {
  const item = remote.item && typeof remote.item === "object" ? (remote.item as Record<string, unknown>) : null;
  if (remote.id !== expectedId) return "plan id";
  if (!item) return "plan item";
  if (item.amount !== plan.amount_paise) return "amount";
  if (item.currency !== plan.currency) return "currency";
  if (remote.period !== plan.billing_period) return "period";
  if (remote.interval !== plan.billing_interval) return "interval";
  return null;
}

function sessionFor(deps: BillingDeps, plan: PlanRow, subscriptionId: string, user: CheckoutUser): CheckoutSession {
  const prefill: CheckoutSession["prefill"] = {};
  if (user.email) prefill.email = user.email;
  if (user.name) prefill.name = user.name.slice(0, 80);
  return {
    keyId: deps.config.keyId,
    subscriptionId,
    mode: deps.config.mode,
    plan: { code: plan.code, name: plan.name, amountPaise: plan.amount_paise, period: plan.billing_period, interval: plan.billing_interval },
    prefill,
  };
}

/**
 * Creates (or reuses) the Razorpay subscription a signed-in account pays for in Checkout. Nothing here
 * grants access: the subscription stays "created" until Razorpay reports the payment.
 */
export async function startCheckout(deps: BillingDeps, user: CheckoutUser, planCode: string): Promise<CheckoutOutcome> {
  const { mode } = deps.config;
  let plan: PlanRow | null;
  let subscriptions;
  try {
    [plan, subscriptions] = await Promise.all([findActivePlan(deps.db, planCode), listUserSubscriptions(deps.db, user.id, mode)]);
  } catch (error) {
    if (error instanceof BillingStoreError && error.kind === "missing_schema") return { kind: "unavailable" };
    throw error;
  }
  if (!plan) return { kind: "plan_not_found" };
  const remotePlanId = providerPlanId(plan, mode);
  if (!remotePlanId || plan.currency !== "INR") return { kind: "plan_unavailable" };
  if (subscriptions.some((subscription) => LIVE_SUBSCRIPTION_STATUSES.has(subscription.status))) return { kind: "already_subscribed" };

  const open = subscriptions.find((subscription) => subscription.status === "created" && !subscription.abandoned_at);
  if (
    open &&
    open.plan_id === plan.id &&
    open.provider_plan_id === remotePlanId &&
    deps.now().getTime() - Date.parse(open.created_at) < REUSE_OPEN_CHECKOUT_MS
  ) {
    // Offered again as it is, without a Razorpay call: reopening Checkout for the same subscription
    // never creates a second one, so even if it was paid in an earlier visit only one can renew.
    return { kind: "ready", session: sessionFor(deps, plan, open.provider_subscription_id, user), reused: true };
  }

  // From here on a new Razorpay subscription is created, at most CHECKOUTS_PER_DAY a day.
  const retryAfterSeconds = checkoutRetryAfterSeconds(subscriptions, deps.now());
  if (retryAfterSeconds !== null) {
    console.warn("[fitx-billing] checkout refused: the account reached the daily limit of new checkouts");
    return { kind: "rate_limited", retryAfterSeconds };
  }

  if (open) {
    // The open checkout is about to be replaced (marked abandoned). It may have been paid in an earlier
    // visit while Razorpay's webhook is still on its way: ask Razorpay first, and never start a second
    // subscription without knowing.
    let remoteStatus;
    try {
      remoteStatus = await syncCheckoutSubscription(deps, open.provider_subscription_id, `api:checkout:${open.provider_subscription_id}:${deps.now().getTime()}`);
    } catch (error) {
      logFailure("checkout open subscription lookup", error);
      if (!(error instanceof RazorpayApiError)) throw error;
      return { kind: "provider_error", retryable: error.retryable };
    }
    if (remoteStatus && LIVE_SUBSCRIPTION_STATUSES.has(remoteStatus)) return { kind: "already_subscribed" };
  }

  // Charge exactly what FITX shows: the Razorpay plan must match the plan row.
  try {
    const remote = await deps.razorpay.fetchPlan(remotePlanId);
    const mismatch = planMismatch(plan, remote, remotePlanId);
    if (mismatch) {
      console.error(`[fitx-billing] plan ${plan.code} does not match its Razorpay plan (${mismatch}); checkout refused`);
      return { kind: "plan_unavailable" };
    }
  } catch (error) {
    logFailure("checkout plan lookup", error);
    if (error instanceof RazorpayApiError && error.status === 404) return { kind: "plan_unavailable" };
    return { kind: "provider_error", retryable: !(error instanceof RazorpayApiError) || error.retryable };
  }

  const cycles = billingCyclesForTenYears(plan.billing_period, plan.billing_interval);
  let created;
  try {
    created = normalizeSubscription(
      await deps.razorpay.createSubscription({
        plan_id: remotePlanId,
        total_count: cycles,
        quantity: 1,
        customer_notify: true,
        notes: { fitx_user_id: user.id, fitx_plan: plan.code },
      }),
    );
  } catch (error) {
    logFailure("checkout subscription create", error);
    return { kind: "provider_error", retryable: !(error instanceof RazorpayApiError) || error.retryable };
  }
  if (!created || created.status !== "created") {
    console.error("[fitx-billing] checkout: Razorpay returned an unexpected subscription");
    return { kind: "provider_error", retryable: false };
  }

  try {
    await recordCheckout(deps.db, {
      userId: user.id,
      planId: plan.id,
      mode,
      providerSubscriptionId: created.provider_subscription_id,
      providerPlanId: remotePlanId,
      totalCount: created.total_count ?? cycles,
    });
  } catch (error) {
    if (error instanceof BillingStoreError && error.kind === "already_subscribed") return { kind: "already_subscribed" };
    if (error instanceof BillingStoreError && error.kind === "rate_limited") {
      // Parallel requests got past the check above; Razorpay's new subscription is never shown or paid.
      return { kind: "rate_limited", retryAfterSeconds: checkoutRetryAfterSeconds(subscriptions, deps.now()) ?? 3600 };
    }
    if (error instanceof BillingStoreError && error.kind === "conflict") {
      // Another tab recorded a checkout at the same moment: offer that one.
      const again = (await listUserSubscriptions(deps.db, user.id, mode)).find(
        (subscription) => subscription.status === "created" && !subscription.abandoned_at,
      );
      if (again) return { kind: "ready", session: sessionFor(deps, plan, again.provider_subscription_id, user), reused: true };
    }
    logFailure("checkout record", error);
    if (error instanceof BillingStoreError && error.kind === "missing_schema") return { kind: "unavailable" };
    throw error;
  }
  return { kind: "ready", session: sessionFor(deps, plan, created.provider_subscription_id, user), reused: false };
}

export type CheckoutConfirmation = { paymentId: string; subscriptionId: string; signature: string };

/**
 * Checks the signature Checkout returned against the subscription FITX stored for this account. The
 * browser's answer itself changes nothing and grants nothing. When it is genuine and the checkout is
 * still "created" in FITX, the server reads the subscription from Razorpay and applies Razorpay's own
 * answer, so a paid checkout stops looking unpaid without waiting for the webhook. Premium still
 * starts only from the captured payment Razorpay reports.
 */
export async function verifyCheckout(deps: BillingDeps, userId: string, input: CheckoutConfirmation): Promise<boolean> {
  if (!isRazorpayId("payment", input.paymentId) || !isRazorpayId("subscription", input.subscriptionId)) return false;
  const owned = (await listUserSubscriptions(deps.db, userId, deps.config.mode)).find(
    (subscription) => subscription.provider_subscription_id === input.subscriptionId,
  );
  if (!owned) return false;
  const verified = verifyCheckoutSignature(
    { paymentId: input.paymentId, subscriptionId: owned.provider_subscription_id, signature: input.signature },
    deps.config.keySecret,
  );
  if (verified && owned.status === "created") {
    try {
      await syncCheckoutSubscription(deps, owned.provider_subscription_id, `api:verify:${owned.provider_subscription_id}:${input.paymentId}`);
    } catch (error) {
      // The webhook (or the nightly reconciliation) brings the same state; the answer stays "verified".
      logFailure("checkout verify read", error);
    }
  }
  return verified;
}
