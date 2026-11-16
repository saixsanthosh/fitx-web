import "server-only";
import { createHash } from "node:crypto";
import { applyBillingEvent, BillingStoreError } from "./db";
import type { BillingDeps } from "./deps";
import { normalizeInvoice, parseWebhookEvent, usableEventId, type BillingEvent, type PaymentRecord } from "./events";
import { RazorpayApiError } from "./razorpay";
import { verifyWebhookSignature } from "./signature";

export type WebhookResult = { status: number; body: Record<string, unknown> };

/** Razorpay webhook bodies are a few kilobytes; anything far larger is not from Razorpay. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

/** Payment events that may arrive without their subscription; the invoice names it. */
const INVOICE_LINKED_EVENTS: ReadonlySet<string> = new Set(["payment.captured", "payment.failed"]);

/**
 * Verifies and applies one Razorpay webhook delivery.
 *  - 400 when the signature does not match (nothing is read or written).
 *  - 200 once the event is applied, was already applied (redelivery), or is not one FITX acts on.
 *  - 409, 500 or 503 when it could not be applied now, so Razorpay retries it later.
 */
export async function handleWebhook(
  deps: BillingDeps,
  { rawBody, signature, eventIdHeader }: { rawBody: Uint8Array; signature: string | null; eventIdHeader: string | null },
): Promise<WebhookResult> {
  if (rawBody.byteLength > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "payload_too_large" } };
  if (!verifyWebhookSignature(rawBody, signature, deps.config.webhookSecret)) {
    console.warn("[fitx-billing] webhook rejected: the signature did not match");
    return { status: 400, body: { error: "invalid_signature" } };
  }

  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  } catch {
    return { status: 400, body: { error: "malformed_event" } };
  }
  const parsed = parseWebhookEvent(body);
  if (parsed.kind === "malformed") return { status: 400, body: { error: "malformed_event" } };
  if (parsed.kind === "ignored") return { status: 200, body: { outcome: "ignored", detail: parsed.reason } };
  if (parsed.skipped.length) {
    console.warn(`[fitx-billing] webhook ${parsed.eventType}: unusable ${parsed.skipped.join(", ")} entity left out`);
  }

  let payment: PaymentRecord | undefined = parsed.payment;
  if (payment && !payment.provider_subscription_id && payment.provider_invoice_id && INVOICE_LINKED_EVENTS.has(parsed.eventType)) {
    try {
      const invoice = normalizeInvoice(await deps.razorpay.fetchInvoice(payment.provider_invoice_id));
      if (invoice?.subscription_id) {
        payment = {
          ...payment,
          provider_subscription_id: invoice.subscription_id,
          period_start: invoice.billing_start,
          period_end: invoice.billing_end,
        };
      }
    } catch (error) {
      if (!(error instanceof RazorpayApiError) || error.retryable) {
        console.warn("[fitx-billing] webhook: the invoice lookup failed; Razorpay will retry the event");
        return { status: 503, body: { error: "provider_unavailable" } };
      }
      // Not a subscription invoice (4xx): apply the payment without a link; it is ignored if unknown.
    }
  }

  const event: BillingEvent = {
    event_id: usableEventId(eventIdHeader) ?? `sha256:${createHash("sha256").update(rawBody).digest("hex")}`,
    source: "webhook",
    event_type: parsed.eventType,
    mode: deps.config.mode,
    event_created_at: parsed.createdAt,
    payload: parsed.payload,
    ...(parsed.subscription ? { subscription: parsed.subscription } : {}),
    ...(payment ? { payment } : {}),
    ...(parsed.refund ? { refund: parsed.refund } : {}),
  };

  try {
    const result = await applyBillingEvent(deps.db, event);
    return { status: 200, body: { outcome: result.outcome, ...(result.detail ? { detail: result.detail } : {}) } };
  } catch (error) {
    if (error instanceof BillingStoreError && error.kind === "mode_mismatch") {
      console.warn(`[fitx-billing] webhook ${parsed.eventType}: the record belongs to the other Razorpay mode; not applied`);
      return { status: 409, body: { error: "mode_mismatch" } };
    }
    if (error instanceof BillingStoreError && error.kind === "missing_schema") {
      console.error("[fitx-billing] webhook: the billing migration is not applied");
      return { status: 503, body: { error: "billing_not_installed" } };
    }
    console.error(`[fitx-billing] webhook ${parsed.eventType}: ${error instanceof Error ? error.message : "apply failed"}`);
    return { status: 500, body: { error: "not_applied" } };
  }
}
