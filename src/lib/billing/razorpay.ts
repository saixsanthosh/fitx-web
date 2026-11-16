import "server-only";
import { RAZORPAY_API_BASE } from "./config";
import { RAZORPAY_ID_PATTERNS } from "./ids";

/**
 * The few Razorpay REST calls FITX makes, with fetch and HTTP Basic auth (key id and secret). The
 * secret is only ever placed in the Authorization header; errors carry Razorpay's code and status,
 * never the request.
 */

export type RazorpayEntity = Record<string, unknown>;

export class RazorpayApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly description: string | null;

  constructor(message: string, status: number, code: string | null = null, description: string | null = null) {
    super(message);
    this.name = "RazorpayApiError";
    this.status = status;
    this.code = code;
    this.description = description;
  }

  /** Network failures, rate limits and server errors may succeed later; 4xx answers will not. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

function requireId(kind: keyof typeof RAZORPAY_ID_PATTERNS, id: string) {
  if (!RAZORPAY_ID_PATTERNS[kind].test(id)) throw new RazorpayApiError(`Invalid Razorpay ${kind} id`, 400, "FITX_INVALID_ID");
  return id;
}

export type CreateSubscriptionInput = {
  plan_id: string;
  total_count: number;
  quantity?: number;
  customer_notify?: boolean;
  notes?: Record<string, string>;
};

export type RazorpayClient = {
  fetchPlan(planId: string): Promise<RazorpayEntity>;
  createSubscription(input: CreateSubscriptionInput): Promise<RazorpayEntity>;
  fetchSubscription(subscriptionId: string): Promise<RazorpayEntity>;
  cancelSubscription(subscriptionId: string): Promise<RazorpayEntity>;
  fetchInvoice(invoiceId: string): Promise<RazorpayEntity>;
  listSubscriptionInvoices(subscriptionId: string): Promise<RazorpayEntity[]>;
  fetchPayment(paymentId: string): Promise<RazorpayEntity>;
  listPaymentRefunds(paymentId: string): Promise<RazorpayEntity[]>;
};

export function createRazorpayClient({
  keyId,
  keySecret,
  apiBase = RAZORPAY_API_BASE,
  timeoutMs = 8000,
  fetchImpl = fetch,
}: {
  keyId: string;
  keySecret: string;
  apiBase?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): RazorpayClient {
  const authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

  async function call(method: "GET" | "POST", path: string, label: string, body?: Record<string, unknown>): Promise<RazorpayEntity> {
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: {
          authorization,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new RazorpayApiError(`Razorpay ${label} did not answer`, 0, "FITX_NETWORK");
    }
    const text = await response.text().catch(() => "");
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const error = (json as { error?: { code?: unknown; description?: unknown } } | null)?.error;
      throw new RazorpayApiError(
        `Razorpay ${label} failed with HTTP ${response.status}`,
        response.status,
        typeof error?.code === "string" ? error.code : null,
        typeof error?.description === "string" ? error.description.slice(0, 300) : null,
      );
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new RazorpayApiError(`Razorpay ${label} returned an unreadable answer`, 502, "FITX_UNREADABLE");
    }
    return json as RazorpayEntity;
  }

  const items = (collection: RazorpayEntity): RazorpayEntity[] =>
    Array.isArray(collection.items) ? collection.items.filter((item): item is RazorpayEntity => Boolean(item) && typeof item === "object") : [];

  return {
    fetchPlan: (planId) => call("GET", `/plans/${requireId("plan", planId)}`, "plan lookup"),
    createSubscription: (input) => {
      requireId("plan", input.plan_id);
      return call("POST", "/subscriptions", "subscription create", input);
    },
    fetchSubscription: (id) => call("GET", `/subscriptions/${requireId("subscription", id)}`, "subscription lookup"),
    // Cancels at once: renewals stop now, and FITX keeps Premium until the end of the paid period.
    cancelSubscription: (id) =>
      call("POST", `/subscriptions/${requireId("subscription", id)}/cancel`, "subscription cancel", { cancel_at_cycle_end: false }),
    fetchInvoice: (id) => call("GET", `/invoices/${requireId("invoice", id)}`, "invoice lookup"),
    listSubscriptionInvoices: async (id) =>
      items(await call("GET", `/invoices?subscription_id=${requireId("subscription", id)}&count=100`, "invoice list")),
    fetchPayment: (id) => call("GET", `/payments/${requireId("payment", id)}`, "payment lookup"),
    listPaymentRefunds: async (id) => items(await call("GET", `/payments/${requireId("payment", id)}/refunds?count=100`, "refund list")),
  };
}
