import "server-only";
import { applyBillingEvent, BillingStoreError, listUserSubscriptions } from "./db";
import type { BillingDeps } from "./deps";
import { normalizeSubscription, trimForStorage, type SubscriptionSnapshot } from "./events";
import { RazorpayApiError, type RazorpayEntity } from "./razorpay";
import { LIVE_SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "./types";

export type CancelOutcome =
  | { kind: "cancelled"; status: SubscriptionStatus; accessUntil: string | null }
  | { kind: "nothing_to_cancel" }
  | { kind: "unavailable" }
  | { kind: "provider_error"; retryable: boolean };

/**
 * Stops renewals for the account's subscription. Razorpay cancels it at once (no further charges and
 * the mandate ends); FITX keeps Premium until the end of the period that was already paid for.
 */
export async function cancelForUser(deps: BillingDeps, userId: string): Promise<CancelOutcome> {
  let rows;
  try {
    rows = await listUserSubscriptions(deps.db, userId, deps.config.mode);
  } catch (error) {
    if (error instanceof BillingStoreError && error.kind === "missing_schema") return { kind: "unavailable" };
    throw error;
  }
  const live = rows.find((row) => LIVE_SUBSCRIPTION_STATUSES.has(row.status));
  if (!live) return { kind: "nothing_to_cancel" };

  let entity: RazorpayEntity;
  let cancelledByUs = true;
  try {
    entity = await deps.razorpay.cancelSubscription(live.provider_subscription_id);
  } catch (error) {
    if (!(error instanceof RazorpayApiError)) throw error;
    console.error(`[fitx-billing] cancel: Razorpay HTTP ${error.status}${error.code ? ` ${error.code}` : ""}`);
    if (error.status !== 400) return { kind: "provider_error", retryable: error.retryable };
    // Razorpay refuses to cancel twice: read the real state (for example cancelled from the Dashboard).
    try {
      entity = await deps.razorpay.fetchSubscription(live.provider_subscription_id);
      cancelledByUs = false;
    } catch (lookup) {
      return { kind: "provider_error", retryable: lookup instanceof RazorpayApiError ? lookup.retryable : true };
    }
  }

  const snapshot = normalizeSubscription(entity);
  if (!snapshot || snapshot.provider_subscription_id !== live.provider_subscription_id) {
    console.error("[fitx-billing] cancel: Razorpay returned an unexpected subscription");
    return { kind: "provider_error", retryable: false };
  }
  const subscription: SubscriptionSnapshot = cancelledByUs ? { ...snapshot, cancel_requested: true } : snapshot;
  const now = deps.now();
  await applyBillingEvent(deps.db, {
    event_id: `api:cancel:${live.provider_subscription_id}:${now.getTime()}`,
    source: "api",
    event_type: cancelledByUs ? "fitx.subscription_cancel" : "fitx.subscription_read",
    mode: deps.config.mode,
    event_created_at: now.toISOString(),
    payload: { subscription: trimForStorage(entity) } as Record<string, unknown>,
    subscription,
  });
  return { kind: "cancelled", status: snapshot.status ?? live.status, accessUntil: live.paid_until };
}
