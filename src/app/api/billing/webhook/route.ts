import { logBillingUnavailable, readBillingConfig } from "@/lib/billing/config";
import { createBillingDeps } from "@/lib/billing/deps";
import { noStore } from "@/lib/billing/http";
import { handleWebhook, MAX_WEBHOOK_BYTES } from "@/lib/billing/webhook";

// Razorpay expects an answer within 5 seconds; slower deliveries count as failures and are retried.
export const maxDuration = 10;

/**
 * Razorpay webhook (Dashboard -> Webhooks -> URL https://<site>/api/billing/webhook). The body is read
 * as raw bytes and its X-Razorpay-Signature checked with RAZORPAY_WEBHOOK_SECRET before anything else.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return noStore({ error: "payload_too_large" }, 413);

  const config = readBillingConfig();
  if (!config.ok) {
    logBillingUnavailable(config.reason);
    return noStore({ error: "billing_not_configured" }, 503);
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  const result = await handleWebhook(createBillingDeps(config.config, { dbTimeoutMs: 3500, razorpayTimeoutMs: 2500 }), {
    rawBody,
    signature: request.headers.get("x-razorpay-signature"),
    eventIdHeader: request.headers.get("x-razorpay-event-id"),
  });
  return noStore(result.body, result.status);
}
