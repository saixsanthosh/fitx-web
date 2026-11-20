// Pure helpers for the Billing page: they validate what the billing_admin_* database functions return
// and format it. No imports, so they can be tested on their own. Amounts are integers in paise.

export type BillingMode = "live" | "test";

/**
 * Razorpay billing periods end at 00:00 India time, so a period ending at that instant covers the day
 * before it. Returns the instant just before `end`, to show the last covered day ("Paid through").
 */
export function lastCoveredInstant(end: string | null): string | null {
  if (!end) return null;
  const at = Date.parse(end);
  return Number.isNaN(at) ? null : new Date(at - 1).toISOString();
}
export type PaymentFilter = "all" | "captured" | "failed" | "refunded";

export type MonthTotal = { month: string; capturedPaise: number; refundedPaise: number };
export type BillingOverview = {
  subscribersWithAccess: number;
  subscriptionsByStatus: Record<string, number>;
  capturedTotal: number;
  refundedTotal: number;
  feesTotal: number;
  capturedMonth: number;
  refundedMonth: number;
  paymentsCaptured30d: number;
  paymentsFailed30d: number;
  refundsPending: number;
  webhooksIgnored30d: number;
  lastWebhookAt: string | null;
  lastReconciliation: { finishedAt: string; checked: number; corrections: number; errors: number } | null;
  monthly: MonthTotal[];
};

export type SubscriberRow = {
  id: string;
  email: string | null;
  planName: string;
  amountPaise: number;
  period: string;
  interval: number;
  status: string;
  hasAccess: boolean;
  paidUntil: string | null;
  chargeAt: string | null;
  cancelRequestedAt: string | null;
  providerId: string;
  createdAt: string;
};

export type PaymentRow = {
  id: string;
  email: string | null;
  planName: string | null;
  providerId: string;
  amountPaise: number;
  currency: string;
  status: string;
  method: string | null;
  refundedPaise: number;
  errorCode: string | null;
  errorDescription: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string;
};

export type RefundRow = {
  id: string;
  email: string | null;
  providerId: string;
  paymentProviderId: string;
  amountPaise: number;
  currency: string;
  status: string;
  speed: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type PlanRow = {
  code: string;
  name: string;
  amountPaise: number;
  period: string;
  interval: number;
  isActive: boolean;
  hasTestPlan: boolean;
  hasLivePlan: boolean;
};

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Postgres bigint sums can arrive as numbers or numeric strings; anything else is rejected. */
export function count(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d{1,15}$/.test(value)) return Number(value);
  return null;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);
const required = (value: unknown) => (typeof value === "string" ? value : "");

export function parseOverview(data: unknown): BillingOverview | null {
  if (!isRecord(data)) return null;
  const numbers = {
    subscribersWithAccess: count(data.subscribers_with_access),
    capturedTotal: count(data.captured_paise_total),
    refundedTotal: count(data.refunded_paise_total),
    feesTotal: count(data.fees_paise_total),
    capturedMonth: count(data.captured_paise_month),
    refundedMonth: count(data.refunded_paise_month),
    paymentsCaptured30d: count(data.payments_captured_30d),
    paymentsFailed30d: count(data.payments_failed_30d),
    refundsPending: count(data.refunds_pending),
    webhooksIgnored30d: count(data.webhooks_ignored_30d),
  };
  if (Object.values(numbers).some((value) => value === null)) return null;

  const byStatus: Record<string, number> = {};
  if (isRecord(data.subscriptions_by_status)) {
    for (const [status, value] of Object.entries(data.subscriptions_by_status)) {
      const n = count(value);
      if (n === null) return null;
      byStatus[status] = n;
    }
  }

  const monthly: MonthTotal[] = [];
  for (const entry of Array.isArray(data.monthly) ? data.monthly : []) {
    if (!isRecord(entry) || typeof entry.month !== "string" || !/^\d{4}-\d{2}$/.test(entry.month)) return null;
    const captured = count(entry.captured_paise);
    const refunded = count(entry.refunded_paise);
    if (captured === null || refunded === null) return null;
    monthly.push({ month: entry.month, capturedPaise: captured, refundedPaise: refunded });
  }

  let lastReconciliation: BillingOverview["lastReconciliation"] = null;
  if (isRecord(data.last_reconciliation)) {
    const run = data.last_reconciliation;
    const checked = count(run.subscriptions_checked);
    const corrections = count(run.corrections);
    const errors = count(run.errors);
    if (typeof run.finished_at === "string" && checked !== null && corrections !== null && errors !== null) {
      lastReconciliation = { finishedAt: run.finished_at, checked, corrections, errors };
    }
  }

  return {
    ...(numbers as { [K in keyof typeof numbers]: number }),
    subscriptionsByStatus: byStatus,
    lastWebhookAt: text(data.last_webhook_at),
    lastReconciliation,
    monthly,
  };
}

const rows = (data: unknown): Json[] => (Array.isArray(data) ? data.filter(isRecord) : []);
const totalOf = (list: Json[]) => (list.length ? count(list[0].total_rows) ?? list.length : 0);

export function parseSubscribers(data: unknown): { rows: SubscriberRow[]; total: number } {
  const list = rows(data);
  return {
    total: totalOf(list),
    rows: list.map((row) => ({
      id: required(row.id),
      email: text(row.email),
      planName: required(row.plan_name),
      amountPaise: count(row.amount_paise) ?? 0,
      period: required(row.billing_period),
      interval: count(row.billing_interval) ?? 1,
      status: required(row.status),
      hasAccess: row.has_access === true,
      paidUntil: text(row.paid_until),
      chargeAt: text(row.charge_at),
      cancelRequestedAt: text(row.cancel_requested_at),
      providerId: required(row.provider_subscription_id),
      createdAt: required(row.created_at),
    })),
  };
}

export function parsePayments(data: unknown): { rows: PaymentRow[]; total: number } {
  const list = rows(data);
  return {
    total: totalOf(list),
    rows: list.map((row) => ({
      id: required(row.id),
      email: text(row.email),
      planName: text(row.plan_name),
      providerId: required(row.provider_payment_id),
      amountPaise: count(row.amount_paise) ?? 0,
      currency: text(row.currency) ?? "INR",
      status: required(row.status),
      method: text(row.method),
      refundedPaise: count(row.amount_refunded_paise) ?? 0,
      errorCode: text(row.error_code),
      errorDescription: text(row.error_description),
      periodStart: text(row.period_start),
      periodEnd: text(row.period_end),
      paidAt: required(row.paid_at),
    })),
  };
}

export function parseRefunds(data: unknown): { rows: RefundRow[]; total: number } {
  const list = rows(data);
  return {
    total: totalOf(list),
    rows: list.map((row) => ({
      id: required(row.id),
      email: text(row.email),
      providerId: required(row.provider_refund_id),
      paymentProviderId: required(row.provider_payment_id),
      amountPaise: count(row.amount_paise) ?? 0,
      currency: text(row.currency) ?? "INR",
      status: required(row.status),
      speed: text(row.speed_processed),
      createdAt: required(row.created_at),
      processedAt: text(row.processed_at),
    })),
  };
}

export function parsePlans(data: unknown): PlanRow[] {
  return rows(data).map((row) => ({
    code: required(row.code),
    name: required(row.name),
    amountPaise: count(row.amount_paise) ?? 0,
    period: required(row.billing_period),
    interval: count(row.billing_interval) ?? 1,
    isActive: row.is_active === true,
    hasTestPlan: typeof row.razorpay_plan_id_test === "string" && row.razorpay_plan_id_test.length > 0,
    hasLivePlan: typeof row.razorpay_plan_id_live === "string" && row.razorpay_plan_id_live.length > 0,
  }));
}

// Formatting --------------------------------------------------------------------------------------

const wholeRupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const rupeesAndPaise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

export function formatInr(paise: number): string {
  if (!Number.isFinite(paise)) return "—";
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? wholeRupees.format(rupees) : rupeesAndPaise.format(rupees);
}

/** Revenue as the owner asked for it: captured payments minus processed refunds. */
export const netPaise = (capturedPaise: number, refundedPaise: number) => capturedPaise - refundedPaise;

export function formatSignedInr(paise: number): string {
  return paise < 0 ? `−${formatInr(-paise)}` : formatInr(paise);
}

export function periodLabel(period: string, interval: number): string {
  if (period === "yearly") return interval === 1 ? "per year" : `every ${interval} years`;
  if (period === "monthly") return interval === 1 ? "per month" : `every ${interval} months`;
  return period;
}

const monthFormat = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
/** "2026-11" -> "Nov 2026". */
export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return monthFormat.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

const SUBSCRIPTION_LABELS: Record<string, string> = {
  created: "Checkout not finished",
  authenticated: "Mandate set up",
  active: "Active",
  pending: "Renewal retrying",
  halted: "Renewal failed",
  paused: "Paused",
  cancelled: "Cancelled",
  completed: "Completed",
  expired: "Expired",
};
export const subscriptionLabel = (status: string) => SUBSCRIPTION_LABELS[status] ?? status;
export const subscriptionPill = (status: string) =>
  status === "active" ? "status-good" : status === "halted" ? "status-danger" : "status-neutral";

export function paymentLabel(status: string, refundedPaise: number): string {
  if (status === "captured") return refundedPaise > 0 ? "Partly refunded" : "Captured";
  if (status === "refunded") return "Refunded";
  if (status === "failed") return "Failed";
  if (status === "authorized") return "Authorised";
  return "Created";
}
export const paymentPill = (status: string) => (status === "captured" ? "status-good" : status === "failed" ? "status-danger" : "status-neutral");

export const refundLabel = (status: string) => (status === "processed" ? "Processed" : status === "failed" ? "Failed" : "Pending");
export const refundPill = (status: string) => (status === "processed" ? "status-good" : status === "failed" ? "status-danger" : "status-neutral");

// Query parameters ------------------------------------------------------------------------------

export const parseMode = (value: unknown): BillingMode => (value === "test" ? "test" : "live");
export const parsePaymentFilter = (value: unknown): PaymentFilter =>
  value === "captured" || value === "failed" || value === "refunded" ? value : "all";
export function parsePage(value: unknown): number {
  const n = typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : 1;
  return Math.min(Math.max(n, 1), 1000);
}

// Plans as Admin edits them ----------------------------------------------------------------------

export type PlanDetail = PlanRow & {
  description: string | null;
  features: string[];
  sortOrder: number;
  razorpayPlanIdTest: string | null;
  razorpayPlanIdLive: string | null;
};

/** A billing_plans row with its description, features and Razorpay plan ids (ids are not secret). */
export function parsePlanDetail(data: unknown): PlanDetail | null {
  if (!isRecord(data)) return null;
  const [base] = parsePlans([data]);
  if (!base.code) return null;
  return {
    ...base,
    description: text(data.description),
    features: Array.isArray(data.features) ? data.features.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [],
    sortOrder: typeof data.sort_order === "number" && Number.isInteger(data.sort_order) ? data.sort_order : 0,
    razorpayPlanIdTest: text(data.razorpay_plan_id_test),
    razorpayPlanIdLive: text(data.razorpay_plan_id_live),
  };
}

/**
 * Refunds are issued in the Razorpay Dashboard (Admin holds no Razorpay key and never moves money); this is
 * the payment's page there. Razorpay then reports the refund by webhook and it appears in the ledger.
 */
export function razorpayPaymentUrl(providerPaymentId: string): string | null {
  return /^pay_[A-Za-z0-9]{1,60}$/.test(providerPaymentId) ? `https://dashboard.razorpay.com/app/payments/${providerPaymentId}` : null;
}

/** A captured payment with something left to refund. */
export function canRefund(row: Pick<PaymentRow, "status" | "amountPaise" | "refundedPaise">): boolean {
  return row.status === "captured" && row.refundedPaise < row.amountPaise;
}
