import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import "./support/server-only.mjs";

const { verifyWebhookSignature, verifyCheckoutSignature, signaturesMatch } = await import("@/lib/billing/signature");

const SECRET = "whsec-test-secret";
const body = JSON.stringify({ entity: "event", event: "subscription.charged", payload: {}, created_at: 1_790_000_000 });
const bytes = new TextEncoder().encode(body);
const sign = (message: string | Uint8Array, secret = SECRET) => createHmac("sha256", secret).update(message).digest("hex");

describe("webhook signature (X-Razorpay-Signature)", () => {
  test("accepts the HMAC-SHA256 hex of the exact body with the webhook secret", () => {
    assert.equal(verifyWebhookSignature(bytes, sign(body), SECRET), true);
  });

  test("accepts upper-case hex and surrounding whitespace", () => {
    assert.equal(verifyWebhookSignature(bytes, ` ${sign(body).toUpperCase()} `, SECRET), true);
  });

  test("rejects a body changed by one byte", () => {
    const tampered = new TextEncoder().encode(body.replace("charged", "chargex"));
    assert.equal(verifyWebhookSignature(tampered, sign(body), SECRET), false);
  });

  test("rejects a re-serialised body even when the JSON means the same", () => {
    const reformatted = new TextEncoder().encode(JSON.stringify(JSON.parse(body), null, 2));
    assert.equal(verifyWebhookSignature(reformatted, sign(body), SECRET), false);
  });

  test("rejects the wrong secret, a missing header and malformed signatures", () => {
    assert.equal(verifyWebhookSignature(bytes, sign(body, "another-secret"), SECRET), false);
    assert.equal(verifyWebhookSignature(bytes, null, SECRET), false);
    assert.equal(verifyWebhookSignature(bytes, "", SECRET), false);
    assert.equal(verifyWebhookSignature(bytes, sign(body).slice(0, 63), SECRET), false);
    assert.equal(verifyWebhookSignature(bytes, `${sign(body)}00`, SECRET), false);
    assert.equal(verifyWebhookSignature(bytes, "z".repeat(64), SECRET), false);
    assert.equal(verifyWebhookSignature(bytes, Buffer.from(sign(body), "hex").toString("base64"), SECRET), false);
  });

  test("never verifies without a configured secret", () => {
    assert.equal(verifyWebhookSignature(bytes, sign(body, ""), ""), false);
  });

  test("signaturesMatch does not throw on length mismatches", () => {
    assert.equal(signaturesMatch(sign(body), "abc"), false);
    assert.equal(signaturesMatch("not-hex", sign(body)), false);
  });
});

describe("checkout signature (razorpay_signature)", () => {
  const KEY_SECRET = "test-key-secret";
  const paymentId = "pay_TestPayment0001";
  const subscriptionId = "sub_TestSubscr0001";
  const valid = createHmac("sha256", KEY_SECRET).update(`${paymentId}|${subscriptionId}`).digest("hex");

  test("is HMAC-SHA256(payment_id + '|' + subscription_id) with the key secret", () => {
    assert.equal(verifyCheckoutSignature({ paymentId, subscriptionId, signature: valid }, KEY_SECRET), true);
  });

  test("rejects another subscription id, swapped order, and the webhook secret", () => {
    assert.equal(verifyCheckoutSignature({ paymentId, subscriptionId: "sub_TestSubscr0002", signature: valid }, KEY_SECRET), false);
    const swapped = createHmac("sha256", KEY_SECRET).update(`${subscriptionId}|${paymentId}`).digest("hex");
    assert.equal(verifyCheckoutSignature({ paymentId, subscriptionId, signature: swapped }, KEY_SECRET), false);
    assert.equal(verifyCheckoutSignature({ paymentId, subscriptionId, signature: valid }, SECRET), false);
    assert.equal(verifyCheckoutSignature({ paymentId: "", subscriptionId, signature: valid }, KEY_SECRET), false);
  });
});
