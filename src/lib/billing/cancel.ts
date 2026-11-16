import "server-only";
import { applyBillingEvent, BillingStoreError, listUserSubscriptions } from "./db";
import type { BillingDeps } from "./deps";
import { normalizeSubscription, trimForStorage, type SubscriptionSnapshot } from "./events";
import { RazorpayApiError, type RazorpayEntity } from "./razorpay";
import { FINAL_SUBSCRIPTION_STATUSES, LIVE_SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "./types";

export type CancelOutcome =
  | { kind: "cancelled"; status: SubscriptionStatus; accessUntil: string | null }
  | { kind: "nothing_to_cancel" }
  | { kind: "unavailable" }
  /**
   * Renewals were not stopped. stillBilling: FITX read the subscription back and Razorpay is still
   * billing it (the cancel was refused, for example while another change to it was in progress).
   * Otherwise Razorpay could not be reached to cancel the subscription or to check it.
   */
  | { kind: "provider_error"; retryable: boolean; stillBilling: boolean };

/**
 * Stops renewals for the account's subscription. Razorpay cancels it at once (no further charges and
 * the mandate ends); FITX keeps Premium until the end of the period that was already paid for.
 * "cancelled" is returned only when Razorpay itself reports the subscription as ended.
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
  const subscriptionId = live.provider_subscription_id;

  let entity: RazorpayEntity | null = null;
  let cancelledByUs = false;
  try {
    entity = await deps.razorpay.cancelSubscription(subscriptionId);
    cancelledByUs = true;
  } catch (error) {
    if (!(error instanceof RazorpayApiError)) throw error;
    console.error(`[fitx-billing] cancel: Razorpay HTTP ${error.status}${error.code ? ` ${error.code}` : ""}`);
  }
  if (!entity) {
    // Refused or unanswered: read what Razorpay holds now. It may be cancelled already (from the
    // Dashboard, from another tab, or by a request that timed out after Razorpay acted on it).
    try {
      entity = await deps.razorpay.fetchSubscription(subscriptionId);
    } catch (lookup) {
      return { kind: "provider_error", retryable: lookup instanceof RazorpayApiError ? lookup.retryable : true, stillBilling: false };
    }
  }

  const snapshot = normalizeSubscription(entity);
  if (!snapshot || snapshot.provider_subscription_id !== subscriptionId) {
    console.error("[fitx-billing] cancel: Razorpay returned an unexpected subscription");
    return { kind: "provider_error", retryable: false, stillBilling: false };
  }
  const ended = snapshot.status !== undefined && FINAL_SUBSCRIPTION_STATUSES.has(snapshot.status);
  const subscription: SubscriptionSnapshot = cancelledByUs && ended ? { ...snapshot, cancel_requested: true } : snapshot;
  const now = deps.now();
  try {
    await applyBillingEvent(deps.db, {
      event_id: `api:cancel:${subscriptionId}:${now.getTime()}`,
      source: "api",
      event_type: cancelledByUs ? "fitx.subscription_cancel" : "fitx.subscription_read",
      mode: deps.config.mode,
      event_created_at: now.toISOString(),
      payload: { subscription: trimForStorage(entity) } as Record<string, unknown>,
      subscription,
    });
  } catch (error) {
    // Razorpay's answer stands either way: its subscription.cancelled webhook or the nightly
    // reconciliation records it.
    console.error(`[fitx-billing] cancel: Razorpay's answer could not be recorded yet (${error instanceof BillingStoreError ? error.kind : "error"})`);
  }

  if (!ended) {
    console.error(`[fitx-billing] cancel: Razorpay still reports the subscription as ${snapshot.status ?? "unknown"}`);
    const stillBilling = snapshot.status !== undefined && LIVE_SUBSCRIPTION_STATUSES.has(snapshot.status);
    return { kind: "provider_error", retryable: true, stillBilling };
  }
  return { kind: "cancelled", status: snapshot.status!, accessUntil: live.paid_until };
}
