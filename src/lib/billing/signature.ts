import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** Lower-case hex HMAC-SHA256, the format Razorpay uses for both webhook and Checkout signatures. */
export function hmacSha256Hex(secret: string, message: string | Uint8Array): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** Constant-time comparison of an expected hex digest with the one a request carried. */
export function signaturesMatch(expectedHex: string, provided: string | null | undefined): boolean {
  if (typeof provided !== "string") return false;
  const candidate = provided.trim().toLowerCase();
  if (!HEX_SHA256.test(candidate) || !HEX_SHA256.test(expectedHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(candidate, "hex"));
}

/**
 * X-Razorpay-Signature is HMAC-SHA256 of the exact request body bytes, keyed with the webhook secret.
 * The body must not be parsed or re-serialised before this check.
 */
export function verifyWebhookSignature(rawBody: Uint8Array, signature: string | null | undefined, webhookSecret: string): boolean {
  if (!webhookSecret) return false;
  return signaturesMatch(hmacSha256Hex(webhookSecret, rawBody), signature);
}

/**
 * Checkout's success handler returns razorpay_signature = HMAC-SHA256(payment_id + "|" + subscription_id)
 * keyed with the API key secret. The subscription id must be the one the server stored for this account.
 */
export function verifyCheckoutSignature(
  { paymentId, subscriptionId, signature }: { paymentId: string; subscriptionId: string; signature: string | null | undefined },
  keySecret: string,
): boolean {
  if (!keySecret || !paymentId || !subscriptionId) return false;
  return signaturesMatch(hmacSha256Hex(keySecret, `${paymentId}|${subscriptionId}`), signature);
}
