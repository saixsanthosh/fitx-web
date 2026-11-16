// Synthetic Razorpay entities and webhook bodies, shaped like the samples in Razorpay's documentation
// (razorpay.com/docs/webhooks/subscriptions, /payments, /refunds and the Subscriptions API). Values are
// made up; ids follow Razorpay's formats. Personal fields (email, contact, card, vpa) are included on
// purpose so the tests can check they are not stored.
import { createHmac } from "node:crypto";

export const unix = (date: Date | string | number) => Math.floor(new Date(date).getTime() / 1000);
export const DAY = 24 * 60 * 60;

export type Entity = Record<string, unknown>;

export function subscriptionEntity(fields: Partial<Entity> & { id: string; plan_id: string; status: string }): Entity {
  return {
    entity: "subscription",
    customer_id: "cust_TestCustomer01",
    type: 2,
    quantity: 1,
    current_start: null,
    current_end: null,
    ended_at: null,
    charge_at: null,
    start_at: null,
    end_at: null,
    auth_attempts: 0,
    total_count: 120,
    paid_count: 0,
    customer_notify: true,
    created_at: unix(Date.now()) - DAY,
    expire_by: null,
    short_url: "https://rzp.io/i/test",
    has_scheduled_changes: false,
    change_scheduled_at: null,
    source: "api",
    offer_id: null,
    remaining_count: 120,
    notes: { fitx_user_id: "kept", Important: "dropped from storage" },
    ...fields,
  };
}

export function paymentEntity(fields: Partial<Entity> & { id: string; amount: number; status: string }): Entity {
  return {
    entity: "payment",
    currency: "INR",
    order_id: "order_TestOrder0001",
    invoice_id: "inv_TestInvoice001",
    international: false,
    method: "card",
    amount_refunded: 0,
    refund_status: null,
    captured: fields.status === "captured",
    description: "Recurring Payment via Subscription",
    card_id: "card_TestCard00001",
    card: { id: "card_TestCard00001", entity: "card", name: "Test Person", last4: "1111", network: "Visa", type: "credit", issuer: null, international: false, emi: false },
    bank: null,
    wallet: null,
    vpa: null,
    email: "payer@example.test",
    contact: "+919999999999",
    notes: [],
    fee: fields.status === "captured" ? 470 : null,
    tax: fields.status === "captured" ? 72 : null,
    error_code: null,
    error_description: null,
    error_source: null,
    error_step: null,
    error_reason: null,
    acquirer_data: { auth_code: "123456" },
    created_at: unix(Date.now()),
    ...fields,
  };
}

export function refundEntity(fields: Partial<Entity> & { id: string; payment_id: string; amount: number; status: string }): Entity {
  return {
    entity: "refund",
    currency: "INR",
    notes: [],
    receipt: null,
    acquirer_data: { arn: null },
    created_at: unix(Date.now()),
    batch_id: null,
    speed_processed: "normal",
    speed_requested: "normal",
    ...fields,
  };
}

export function invoiceEntity(fields: Partial<Entity> & { id: string; subscription_id: string; payment_id: string | null }): Entity {
  return {
    entity: "invoice",
    type: "invoice",
    status: fields.payment_id ? "paid" : "issued",
    customer_id: "cust_TestCustomer01",
    order_id: "order_TestOrder0001",
    amount: 19900,
    amount_paid: fields.payment_id ? 19900 : 0,
    amount_due: fields.payment_id ? 0 : 19900,
    currency: "INR",
    billing_start: null,
    billing_end: null,
    paid_at: null,
    created_at: unix(Date.now()),
    ...fields,
  };
}

export function webhookBody(event: string, entities: { subscription?: Entity; payment?: Entity; refund?: Entity }, createdAt = unix(Date.now())) {
  const payload: Record<string, { entity: Entity }> = {};
  for (const [name, entity] of Object.entries(entities)) if (entity) payload[name] = { entity };
  return { entity: "event", account_id: "acc_TestAccount001", event, contains: Object.keys(payload), payload, created_at: createdAt };
}

export const signBody = (raw: string, secret: string) => createHmac("sha256", secret).update(raw).digest("hex");
