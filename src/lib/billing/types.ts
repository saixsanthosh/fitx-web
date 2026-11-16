// Shapes shared by the billing server code and the subscription pages. No secrets live here.

export type BillingMode = "test" | "live";
export type BillingPeriod = "monthly" | "yearly";

export const SUBSCRIPTION_STATUSES = [
  "created",
  "authenticated",
  "active",
  "pending",
  "halted",
  "paused",
  "cancelled",
  "completed",
  "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_STATUSES = ["created", "authorized", "captured", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REFUND_STATUSES = ["pending", "processed", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Razorpay is still billing these subscriptions, so the account cannot start another one. */
export const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "authenticated",
  "active",
  "pending",
  "halted",
  "paused",
]);

/** A cancelled, completed or expired subscription never changes status again. */
export const FINAL_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(["cancelled", "completed", "expired"]);

export const isSubscriptionStatus = (value: unknown): value is SubscriptionStatus =>
  typeof value === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
export const isPaymentStatus = (value: unknown): value is PaymentStatus =>
  typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
export const isRefundStatus = (value: unknown): value is RefundStatus =>
  typeof value === "string" && (REFUND_STATUSES as readonly string[]).includes(value);

/** A plan as the pages show it: everything comes from the billing_plans table. */
export type PlanView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  features: string[];
  amountPaise: number;
  period: BillingPeriod;
  interval: number;
};

export type SubscriptionView = {
  id: string;
  planId: string;
  planName: string | null;
  amountPaise: number | null;
  period: BillingPeriod | null;
  interval: number | null;
  status: SubscriptionStatus;
  mode: BillingMode;
  /** Successful charges Razorpay reports for this subscription. */
  paidCount: number;
  paidUntil: string | null;
  chargeAt: string | null;
  cancelRequestedAt: string | null;
  createdAt: string;
};

export type PaymentView = {
  id: string;
  amountPaise: number;
  currency: string;
  status: PaymentStatus;
  method: string | null;
  refundedPaise: number;
  failureReason: string | null;
  at: string;
  periodStart: string | null;
  periodEnd: string | null;
  mode: BillingMode;
};

export type RefundView = {
  id: string;
  amountPaise: number;
  currency: string;
  status: RefundStatus;
  at: string;
  processedAt: string | null;
  mode: BillingMode;
};
