import type { PaymentStatus, RefundStatus, SubscriptionStatus } from "./types";

export type BillingTone = "good" | "warning" | "danger" | "neutral";

const SUBSCRIPTION_LABELS: Record<SubscriptionStatus, string> = {
  created: "Checkout not finished",
  authenticated: "Payment method set up",
  active: "Active",
  pending: "Renewal being retried",
  halted: "Renewal failed",
  paused: "Paused",
  cancelled: "Cancelled",
  completed: "Completed",
  expired: "Expired",
};

const SUBSCRIPTION_TONES: Record<SubscriptionStatus, BillingTone> = {
  created: "neutral",
  authenticated: "neutral",
  active: "good",
  pending: "warning",
  halted: "danger",
  paused: "warning",
  cancelled: "neutral",
  completed: "neutral",
  expired: "neutral",
};

export const subscriptionStatusLabel = (status: SubscriptionStatus) => SUBSCRIPTION_LABELS[status];
export const subscriptionTone = (status: SubscriptionStatus) => SUBSCRIPTION_TONES[status];

export function paymentStatusLabel(status: PaymentStatus, refundedPaise = 0): string {
  switch (status) {
    case "captured":
      return refundedPaise > 0 ? "Partly refunded" : "Paid";
    case "refunded":
      return "Refunded";
    case "failed":
      return "Failed";
    case "authorized":
      return "Processing";
    default:
      return "Started";
  }
}

export function paymentTone(status: PaymentStatus): BillingTone {
  if (status === "captured") return "good";
  if (status === "failed") return "danger";
  return "neutral";
}

export const refundStatusLabel = (status: RefundStatus) =>
  status === "processed" ? "Refunded" : status === "failed" ? "Refund failed" : "Refund in progress";

const METHOD_LABELS: Record<string, string> = {
  card: "Card",
  upi: "UPI",
  netbanking: "Net banking",
  wallet: "Wallet",
  emandate: "Bank mandate",
  nach: "Bank mandate",
};
export const paymentMethodLabel = (method: string | null) => (method ? METHOD_LABELS[method] ?? method : "—");

// Billing dates follow India Standard Time, like the prices (INR) and the Admin app.
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** "17 Dec 2026", or null for a missing or unreadable date. */
export function formatBillingDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : dateFormat.format(date);
}

/**
 * The last day a paid period covers, for "through <day>". Razorpay ends billing cycles at 00:00 India
 * time, so a period (and Premium) ending at that instant covers the day before it.
 */
export function formatPaidThrough(end: string | null | undefined): string | null {
  if (!end) return null;
  const at = Date.parse(end);
  return Number.isNaN(at) ? null : dateFormat.format(new Date(at - 1));
}
