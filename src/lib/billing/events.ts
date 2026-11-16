import { isRazorpayId } from "./ids";
import {
  isPaymentStatus,
  isRefundStatus,
  isSubscriptionStatus,
  type BillingMode,
  type PaymentStatus,
  type RefundStatus,
  type SubscriptionStatus,
} from "./types";

/**
 * Turns Razorpay entities (from signed webhooks or the server's own API reads) into the event shape
 * that public.billing_apply_event() applies. Pure functions: no network, no secrets.
 *
 * Snapshot rule: a subscription field is sent only when Razorpay's entity contains it (null included),
 * so a partial entity never wipes a value the database already holds.
 */

export type EventSource = "webhook" | "api" | "reconcile";

export type SubscriptionSnapshot = {
  provider_subscription_id: string;
  provider_plan_id?: string;
  provider_customer_id?: string;
  status?: SubscriptionStatus;
  current_start?: string | null;
  current_end?: string | null;
  charge_at?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  ended_at?: string | null;
  paid_count?: number;
  total_count?: number;
  remaining_count?: number | null;
  /** Only for the server's own successful cancel call. */
  cancel_requested?: true;
};

export type PaymentRecord = {
  provider_payment_id: string;
  /** Which FITX subscription the payment belongs to, when the event or the invoice says so. */
  provider_subscription_id?: string;
  provider_invoice_id: string | null;
  provider_order_id: string | null;
  amount_paise: number;
  currency: string;
  status: PaymentStatus;
  method: string | null;
  amount_refunded_paise: number;
  fee_paise: number | null;
  tax_paise: number | null;
  error_code: string | null;
  error_description: string | null;
  error_reason: string | null;
  error_source: string | null;
  error_step: string | null;
  /** The billing period this payment paid for. */
  period_start?: string | null;
  period_end?: string | null;
  provider_created_at: string | null;
};

export type RefundRecord = {
  provider_refund_id: string;
  provider_payment_id: string;
  amount_paise: number;
  currency: string;
  status: RefundStatus;
  speed_requested: string | null;
  speed_processed: string | null;
  provider_created_at: string | null;
};

export type InvoiceRecord = {
  id: string;
  subscription_id: string | null;
  payment_id: string | null;
  status: string | null;
  billing_start: string | null;
  billing_end: string | null;
};

export type BillingEvent = {
  event_id: string;
  source: EventSource;
  event_type: string;
  mode: BillingMode;
  event_created_at: string;
  payload: Record<string, unknown>;
  subscription?: SubscriptionSnapshot;
  payment?: PaymentRecord;
  refund?: RefundRecord;
};

/** Razorpay events FITX acts on. Subscribe the webhook to these (others are acknowledged and ignored). */
export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.completed",
  "subscription.updated",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.paused",
  "subscription.resumed",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "refund.created",
  "refund.processed",
  "refund.failed",
  "refund.speed_changed",
]);

/** In these events the subscription entity's current cycle is the one the included payment paid for. */
const CHARGE_EVENTS: ReadonlySet<string> = new Set(["subscription.charged", "subscription.activated"]);

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Razorpay times are Unix seconds. */
export function unixToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 32503680000) return null;
  return new Date(Math.round(value) * 1000).toISOString();
}

const nonNegativeInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

const currencyOf = (value: unknown): string | null => (typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null);

/** Webhook payload entries look like { entity: {...} }. */
function entityOf(value: unknown): Json | null {
  if (!isRecord(value)) return null;
  return isRecord(value.entity) ? value.entity : null;
}

export function normalizeSubscription(entity: unknown): SubscriptionSnapshot | null {
  if (!isRecord(entity) || (entity.entity !== undefined && entity.entity !== "subscription")) return null;
  if (!isRazorpayId("subscription", entity.id)) return null;
  const snapshot: SubscriptionSnapshot = { provider_subscription_id: entity.id };
  if (isRazorpayId("plan", entity.plan_id)) snapshot.provider_plan_id = entity.plan_id;
  const customer = clip(entity.customer_id, 80);
  if (customer) snapshot.provider_customer_id = customer;
  if (isSubscriptionStatus(entity.status)) snapshot.status = entity.status;
  for (const key of ["current_start", "current_end", "charge_at", "start_at", "end_at", "ended_at"] as const) {
    if (key in entity) snapshot[key] = unixToIso(entity[key]);
  }
  const paid = nonNegativeInt(entity.paid_count);
  if (paid !== null) snapshot.paid_count = paid;
  const total = nonNegativeInt(entity.total_count);
  if (total !== null && total > 0) snapshot.total_count = total;
  if ("remaining_count" in entity) snapshot.remaining_count = nonNegativeInt(entity.remaining_count);
  return snapshot;
}

export function normalizePayment(entity: unknown): PaymentRecord | null {
  if (!isRecord(entity) || (entity.entity !== undefined && entity.entity !== "payment")) return null;
  if (!isRazorpayId("payment", entity.id)) return null;
  const amount = nonNegativeInt(entity.amount);
  const currency = currencyOf(entity.currency);
  if (amount === null || !currency || !isPaymentStatus(entity.status)) return null;
  return {
    provider_payment_id: entity.id,
    provider_invoice_id: isRazorpayId("invoice", entity.invoice_id) ? entity.invoice_id : null,
    provider_order_id: isRazorpayId("order", entity.order_id) ? entity.order_id : null,
    amount_paise: amount,
    currency,
    status: entity.status,
    method: clip(entity.method, 40),
    amount_refunded_paise: nonNegativeInt(entity.amount_refunded) ?? 0,
    fee_paise: nonNegativeInt(entity.fee),
    tax_paise: nonNegativeInt(entity.tax),
    error_code: clip(entity.error_code, 100),
    error_description: clip(entity.error_description, 500),
    error_reason: clip(entity.error_reason, 100),
    error_source: clip(entity.error_source, 100),
    error_step: clip(entity.error_step, 100),
    provider_created_at: unixToIso(entity.created_at),
  };
}

export function normalizeRefund(entity: unknown): RefundRecord | null {
  if (!isRecord(entity) || (entity.entity !== undefined && entity.entity !== "refund")) return null;
  if (!isRazorpayId("refund", entity.id) || !isRazorpayId("payment", entity.payment_id)) return null;
  const amount = nonNegativeInt(entity.amount);
  const currency = currencyOf(entity.currency);
  if (!amount || !currency || !isRefundStatus(entity.status)) return null;
  return {
    provider_refund_id: entity.id,
    provider_payment_id: entity.payment_id,
    amount_paise: amount,
    currency,
    status: entity.status,
    speed_requested: clip(entity.speed_requested, 20),
    speed_processed: clip(entity.speed_processed, 20),
    provider_created_at: unixToIso(entity.created_at),
  };
}

export function normalizeInvoice(entity: unknown): InvoiceRecord | null {
  if (!isRecord(entity) || !isRazorpayId("invoice", entity.id)) return null;
  return {
    id: entity.id,
    subscription_id: isRazorpayId("subscription", entity.subscription_id) ? entity.subscription_id : null,
    payment_id: isRazorpayId("payment", entity.payment_id) ? entity.payment_id : null,
    status: clip(entity.status, 30),
    billing_start: unixToIso(entity.billing_start),
    billing_end: unixToIso(entity.billing_end),
  };
}

// Stored payloads keep ids, amounts, statuses and error codes, but not who paid or with what.
const PRIVATE_KEYS: ReadonlySet<string> = new Set([
  "email",
  "contact",
  "vpa",
  "card",
  "upi",
  "bank_account",
  "customer_details",
  "billing_address",
  "shipping_address",
  "acquirer_data",
  "token_id",
  "card_id",
  "emi",
]);

/** A copy of a Razorpay payload without contact details, card or UPI data, and without other notes than FITX's own. */
export function trimForStorage(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => trimForStorage(item, depth + 1));
  if (isRecord(value)) {
    const out: Json = {};
    for (const [key, item] of Object.entries(value)) {
      if (PRIVATE_KEYS.has(key)) continue;
      if (key === "notes") {
        out.notes = isRecord(item)
          ? Object.fromEntries(Object.entries(item).filter(([note]) => note.startsWith("fitx_")).map(([note, text]) => [note, clip(text, 120)]))
          : {};
        continue;
      }
      out[key] = trimForStorage(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.slice(0, 500);
  return value;
}

export type ParsedWebhook =
  | {
      kind: "event";
      eventType: string;
      createdAt: string;
      payload: Json;
      subscription?: SubscriptionSnapshot;
      payment?: PaymentRecord;
      refund?: RefundRecord;
      /** Entities that were present but unusable (logged, not applied). */
      skipped: string[];
    }
  | { kind: "ignored"; eventType: string; reason: "unhandled_event" | "nothing_usable" }
  | { kind: "malformed" };

/** Reads a verified webhook body: { entity: "event", event, payload: { subscription?, payment?, refund? }, created_at }. */
export function parseWebhookEvent(body: unknown): ParsedWebhook {
  if (!isRecord(body) || body.entity !== "event" || typeof body.event !== "string" || !isRecord(body.payload)) {
    return { kind: "malformed" };
  }
  const eventType = body.event.slice(0, 80);
  if (!HANDLED_EVENT_TYPES.has(eventType)) return { kind: "ignored", eventType, reason: "unhandled_event" };

  const skipped: string[] = [];
  const subscriptionEntity = entityOf(body.payload.subscription);
  const paymentEntity = entityOf(body.payload.payment);
  const refundEntity = entityOf(body.payload.refund);

  const subscription = subscriptionEntity ? normalizeSubscription(subscriptionEntity) ?? undefined : undefined;
  if (subscriptionEntity && !subscription) skipped.push("subscription");
  const payment = paymentEntity ? normalizePayment(paymentEntity) ?? undefined : undefined;
  if (paymentEntity && !payment) skipped.push("payment");
  const refund = refundEntity ? normalizeRefund(refundEntity) ?? undefined : undefined;
  if (refundEntity && !refund) skipped.push("refund");

  if (payment && subscription) {
    payment.provider_subscription_id = subscription.provider_subscription_id;
    if (CHARGE_EVENTS.has(eventType) && subscription.current_start && subscription.current_end) {
      payment.period_start = subscription.current_start;
      payment.period_end = subscription.current_end;
    }
  }

  if (!subscription && !payment && !refund) return { kind: "ignored", eventType, reason: "nothing_usable" };
  return {
    kind: "event",
    eventType,
    createdAt: unixToIso(body.created_at) ?? new Date().toISOString(),
    payload: trimForStorage(body.payload) as Json,
    ...(subscription ? { subscription } : {}),
    ...(payment ? { payment } : {}),
    ...(refund ? { refund } : {}),
    skipped,
  };
}

/** x-razorpay-event-id when it looks like one; otherwise a digest of the body (computed by the caller). */
export function usableEventId(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const id = header.trim();
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(id) ? id : null;
}
