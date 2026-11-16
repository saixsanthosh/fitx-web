import "server-only";
import { applyBillingEvent } from "./db";
import type { BillingDeps } from "./deps";
import { normalizeSubscription, trimForStorage } from "./events";
import { RazorpayApiError } from "./razorpay";
import type { SubscriptionStatus } from "./types";

/**
 * Reads a checkout's subscription from Razorpay with the server's key. When Razorpay has moved it on
 * from "created" (the payment went through, or it ended), that answer is applied like a webhook, so a
 * payment whose webhook is still on its way is not offered again or replaced by a second subscription.
 * A "created" answer is not applied: stamping the row as synced now would make webhooks about a
 * payment that is already on its way look older than this read.
 * Returns Razorpay's status, or null when the answer carries none.
 */
export async function syncCheckoutSubscription(deps: BillingDeps, subscriptionId: string, eventId: string): Promise<SubscriptionStatus | null> {
  const entity = await deps.razorpay.fetchSubscription(subscriptionId);
  const snapshot = normalizeSubscription(entity);
  if (!snapshot || snapshot.provider_subscription_id !== subscriptionId) {
    throw new RazorpayApiError("Razorpay returned an unexpected subscription", 502, "FITX_UNEXPECTED");
  }
  if (!snapshot.status || snapshot.status === "created") return snapshot.status ?? null;
  const now = deps.now();
  await applyBillingEvent(deps.db, {
    event_id: eventId,
    source: "api",
    event_type: "fitx.subscription_read",
    mode: deps.config.mode,
    event_created_at: now.toISOString(),
    payload: { subscription: trimForStorage(entity) } as Record<string, unknown>,
    subscription: snapshot,
  });
  return snapshot.status;
}
