import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeInvoice,
  normalizePayment,
  normalizeRefund,
  normalizeSubscription,
  parseWebhookEvent,
  trimForStorage,
  unixToIso,
  usableEventId,
} from "../../src/lib/billing/events.ts";
import { DAY, invoiceEntity, paymentEntity, refundEntity, subscriptionEntity, unix, webhookBody } from "./support/razorpay-payloads.ts";

const START = unix("2026-11-01T00:00:00Z");
const END = START + 30 * DAY;
const SUB = "sub_TestSubscr0001";
const PLAN = "plan_TestMonthly01";

describe("subscription entities", () => {
  test("keep the fields FITX stores, as ISO times", () => {
    const snapshot = normalizeSubscription(
      subscriptionEntity({ id: SUB, plan_id: PLAN, status: "active", current_start: START, current_end: END, charge_at: END, paid_count: 1, remaining_count: 119 }),
    );
    assert.deepEqual(snapshot, {
      provider_subscription_id: SUB,
      provider_plan_id: PLAN,
      provider_customer_id: "cust_TestCustomer01",
      status: "active",
      current_start: "2026-11-01T00:00:00.000Z",
      current_end: "2026-12-01T00:00:00.000Z",
      charge_at: "2026-12-01T00:00:00.000Z",
      start_at: null,
      end_at: null,
      ended_at: null,
      paid_count: 1,
      total_count: 120,
      remaining_count: 119,
    });
  });

  test("leave out fields Razorpay did not send, so they are not wiped", () => {
    const snapshot = normalizeSubscription({ entity: "subscription", id: SUB, status: "halted" });
    assert.deepEqual(snapshot, { provider_subscription_id: SUB, status: "halted" });
  });

  test("drop an unknown status instead of storing it", () => {
    assert.equal(normalizeSubscription({ id: SUB, status: "teleported" })?.status, undefined);
  });

  test("reject ids that are not Razorpay subscription ids", () => {
    assert.equal(normalizeSubscription({ id: "sub_'; drop table x", status: "active" }), null);
    assert.equal(normalizeSubscription({ entity: "payment", id: SUB }), null);
    assert.equal(normalizeSubscription(null), null);
  });
});

describe("payment, refund and invoice entities", () => {
  test("payments keep amounts, status, method and failure reasons", () => {
    const payment = normalizePayment(
      paymentEntity({ id: "pay_TestPayment0001", amount: 19900, status: "failed", error_code: "BAD_REQUEST_ERROR", error_description: "Payment declined by the bank", error_reason: "payment_declined" }),
    );
    assert.equal(payment?.provider_payment_id, "pay_TestPayment0001");
    assert.equal(payment?.amount_paise, 19900);
    assert.equal(payment?.status, "failed");
    assert.equal(payment?.method, "card");
    assert.equal(payment?.provider_invoice_id, "inv_TestInvoice001");
    assert.equal(payment?.error_description, "Payment declined by the bank");
    assert.equal(payment?.error_reason, "payment_declined");
    assert.equal(payment?.fee_paise, null);
  });

  test("payments without a usable amount, currency or status are not applied", () => {
    assert.equal(normalizePayment(paymentEntity({ id: "pay_TestPayment0001", amount: 19.9, status: "captured" })), null);
    assert.equal(normalizePayment(paymentEntity({ id: "pay_TestPayment0001", amount: 19900, status: "pending" })), null);
    assert.equal(normalizePayment(paymentEntity({ id: "pay_TestPayment0001", amount: 19900, status: "captured", currency: "rupees" })), null);
  });

  test("refunds and invoices", () => {
    const refund = normalizeRefund(refundEntity({ id: "rfnd_TestRefund001", payment_id: "pay_TestPayment0001", amount: 19900, status: "processed" }));
    assert.equal(refund?.status, "processed");
    assert.equal(refund?.speed_processed, "normal");
    assert.equal(normalizeRefund(refundEntity({ id: "rfnd_TestRefund001", payment_id: "pay_TestPayment0001", amount: 0, status: "processed" })), null);
    const invoice = normalizeInvoice(invoiceEntity({ id: "inv_TestInvoice001", subscription_id: SUB, payment_id: "pay_TestPayment0001", billing_start: START, billing_end: END }));
    assert.deepEqual(invoice, {
      id: "inv_TestInvoice001",
      subscription_id: SUB,
      payment_id: "pay_TestPayment0001",
      status: "paid",
      billing_start: "2026-11-01T00:00:00.000Z",
      billing_end: "2026-12-01T00:00:00.000Z",
    });
  });
});

describe("webhook bodies", () => {
  const charged = webhookBody(
    "subscription.charged",
    {
      subscription: subscriptionEntity({ id: SUB, plan_id: PLAN, status: "active", current_start: START, current_end: END, charge_at: END, paid_count: 1 }),
      payment: paymentEntity({ id: "pay_TestPayment0001", amount: 19900, status: "captured" }),
    },
    START + 60,
  );

  test("subscription.charged links the payment to the subscription and the cycle it paid for", () => {
    const parsed = parseWebhookEvent(charged);
    assert.equal(parsed.kind, "event");
    if (parsed.kind !== "event") return;
    assert.equal(parsed.eventType, "subscription.charged");
    assert.equal(parsed.createdAt, unixToIso(START + 60));
    assert.equal(parsed.payment?.provider_subscription_id, SUB);
    assert.equal(parsed.payment?.period_start, "2026-11-01T00:00:00.000Z");
    assert.equal(parsed.payment?.period_end, "2026-12-01T00:00:00.000Z");
    assert.deepEqual(parsed.skipped, []);
  });

  test("subscription.pending carries the new, unpaid cycle but no payment period", () => {
    const parsed = parseWebhookEvent(
      webhookBody("subscription.pending", { subscription: subscriptionEntity({ id: SUB, plan_id: PLAN, status: "pending", current_start: END, current_end: END + 30 * DAY }) }),
    );
    assert.equal(parsed.kind === "event" && parsed.subscription?.status, "pending");
    assert.equal(parsed.kind === "event" && parsed.payment, undefined);
  });

  test("payment.failed arrives without its subscription", () => {
    const parsed = parseWebhookEvent(webhookBody("payment.failed", { payment: paymentEntity({ id: "pay_TestPayment0002", amount: 19900, status: "failed" }) }));
    assert.equal(parsed.kind === "event" && parsed.payment?.provider_subscription_id, undefined);
    assert.equal(parsed.kind === "event" && parsed.payment?.provider_invoice_id, "inv_TestInvoice001");
  });

  test("refund events carry the refund and its payment", () => {
    const parsed = parseWebhookEvent(
      webhookBody("refund.processed", {
        refund: refundEntity({ id: "rfnd_TestRefund001", payment_id: "pay_TestPayment0001", amount: 19900, status: "processed" }),
        payment: paymentEntity({ id: "pay_TestPayment0001", amount: 19900, status: "refunded", amount_refunded: 19900, refund_status: "full" }),
      }),
    );
    assert.equal(parsed.kind === "event" && parsed.refund?.amount_paise, 19900);
    assert.equal(parsed.kind === "event" && parsed.payment?.amount_refunded_paise, 19900);
  });

  test("events FITX does not act on, and events with nothing usable, are acknowledged and ignored", () => {
    assert.deepEqual(parseWebhookEvent(webhookBody("order.paid", {})), { kind: "ignored", eventType: "order.paid", reason: "unhandled_event" });
    assert.deepEqual(parseWebhookEvent(webhookBody("payment.captured", { payment: { id: "nope" } })), {
      kind: "ignored",
      eventType: "payment.captured",
      reason: "nothing_usable",
    });
  });

  test("bodies that are not Razorpay events are malformed", () => {
    for (const body of [null, [], "x", { entity: "event" }, { entity: "event", event: "subscription.charged" }, { event: "subscription.charged", payload: {} }]) {
      assert.deepEqual(parseWebhookEvent(body), { kind: "malformed" }, JSON.stringify(body));
    }
  });

  test("stored payloads keep ids and amounts but no contact, card or UPI details, and only FITX notes", () => {
    const parsed = parseWebhookEvent(charged);
    assert.equal(parsed.kind, "event");
    const stored = JSON.stringify(parsed.kind === "event" ? parsed.payload : null);
    for (const secret of ["payer@example.test", "+919999999999", "1111", "Test Person", "card_TestCard00001", "123456", "dropped from storage"]) {
      assert.equal(stored.includes(secret), false, `${secret} must not be stored`);
    }
    assert.ok(stored.includes("pay_TestPayment0001"));
    assert.ok(stored.includes("19900"));
    assert.ok(stored.includes("fitx_user_id"));
    assert.deepEqual(trimForStorage({ notes: { fitx_plan: "premium", phone: "123" }, vpa: "someone@upi", upi: { vpa: "x@y" } }), { notes: { fitx_plan: "premium" } });
  });
});

describe("event ids", () => {
  test("uses x-razorpay-event-id when it looks like one", () => {
    assert.equal(usableEventId("Ev12aBcD34eFgH"), "Ev12aBcD34eFgH");
    assert.equal(usableEventId(" evt_123 "), "evt_123");
    assert.equal(usableEventId(""), null);
    assert.equal(usableEventId("a b"), null);
    assert.equal(usableEventId("x".repeat(121)), null);
    assert.equal(usableEventId(null), null);
  });
});
