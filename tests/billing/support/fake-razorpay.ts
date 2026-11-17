// A stateful stand-in for the Razorpay REST API (v1) on 127.0.0.1. It checks HTTP Basic auth like
// Razorpay does and answers with entities shaped like the documented ones.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { subscriptionEntity, unix, type Entity } from "./razorpay-payloads.ts";

export class FakeRazorpay {
  url = "";
  calls: Array<{ method: string; path: string; authorization: string | undefined; body: unknown }> = [];
  plans = new Map<string, Entity>();
  subscriptions = new Map<string, Entity>();
  invoices = new Map<string, Entity>();
  payments = new Map<string, Entity>();
  refunds = new Map<string, Entity[]>();
  /** The next request whose path matches answers with this status (once). */
  failNext: { path: RegExp; status: number } | null = null;
  /** The next matching request gets no answer at all (connection dropped). */
  dropNext: RegExp | null = null;
  /** The next matching request is carried out, but its answer is lost (as when the caller times out). */
  dropAnswerNext: RegExp | null = null;
  readonly expectedAuthorization: string;
  private server!: Server;
  private counter = 0;

  constructor(keyId: string, keySecret: string) {
    this.expectedAuthorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
  }

  async start(port = 0) {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
    return this;
  }

  stop() {
    this.server.closeAllConnections();
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  addPlan(id: string, amount: number, period: "monthly" | "yearly", interval = 1) {
    this.plans.set(id, {
      id,
      entity: "plan",
      interval,
      period,
      item: { id: `item_${id.slice(5)}`, active: true, name: "FITX Premium", description: null, amount, unit_amount: amount, currency: "INR", type: "plan" },
      notes: [],
      created_at: unix(Date.now()) - 30 * 86400,
    });
  }

  callsTo(method: string, path: RegExp) {
    return this.calls.filter((call) => call.method === method && path.test(call.path));
  }

  private async body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString();
    return text ? JSON.parse(text) : undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const body = req.method === "POST" ? await this.body(req) : undefined;
    const path = `${url.pathname}${url.search}`;
    this.calls.push({ method: req.method ?? "GET", path, authorization: req.headers.authorization, body });
    const loseAnswer = Boolean(this.dropAnswerNext?.test(path));
    if (loseAnswer) this.dropAnswerNext = null;
    const send = (status: number, payload: unknown) => {
      if (loseAnswer) {
        req.socket.destroy();
        return;
      }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const error = (status: number, description: string) =>
      send(status, { error: { code: "BAD_REQUEST_ERROR", description, source: "business", step: "payment_initiation", reason: "input_validation_failed", metadata: {} } });

    if (this.dropNext?.test(path)) {
      this.dropNext = null;
      req.socket.destroy();
      return;
    }
    if (this.failNext?.path.test(path)) {
      const { status } = this.failNext;
      this.failNext = null;
      return error(status, "Simulated failure");
    }
    if (req.headers.authorization !== this.expectedAuthorization) return error(401, "Authentication failed");

    let match: RegExpExecArray | null;
    if (req.method === "GET" && (match = /^\/v1\/plans\/([\w]+)$/.exec(url.pathname))) {
      const plan = this.plans.get(match[1]);
      return plan ? send(200, plan) : error(400, "The id provided does not exist");
    }
    if (req.method === "POST" && url.pathname === "/v1/subscriptions") {
      const input = body as { plan_id: string; total_count: number; notes?: Record<string, string> };
      if (!this.plans.has(input.plan_id)) return error(400, "The id provided does not exist");
      this.counter += 1;
      const id = `sub_TestSubscr${String(this.counter).padStart(4, "0")}`;
      const entity = subscriptionEntity({
        id,
        plan_id: input.plan_id,
        status: "created",
        customer_id: null,
        total_count: input.total_count,
        remaining_count: input.total_count,
        notes: input.notes ?? {},
        created_at: unix(Date.now()),
      });
      this.subscriptions.set(id, entity);
      return send(200, entity);
    }
    if (req.method === "GET" && (match = /^\/v1\/subscriptions\/([\w]+)$/.exec(url.pathname))) {
      const subscription = this.subscriptions.get(match[1]);
      return subscription ? send(200, subscription) : error(400, "The id provided does not exist");
    }
    if (req.method === "POST" && (match = /^\/v1\/subscriptions\/([\w]+)\/cancel$/.exec(url.pathname))) {
      const subscription = this.subscriptions.get(match[1]);
      if (!subscription) return error(400, "The id provided does not exist");
      if (!["created", "authenticated", "active", "pending", "halted", "paused"].includes(String(subscription.status))) {
        return error(400, `Subscription is not cancellable in ${String(subscription.status)} status.`);
      }
      const cancelled = { ...subscription, status: "cancelled", ended_at: unix(Date.now()) };
      this.subscriptions.set(match[1], cancelled);
      return send(200, cancelled);
    }
    if (req.method === "GET" && (match = /^\/v1\/invoices\/([\w]+)$/.exec(url.pathname))) {
      const invoice = this.invoices.get(match[1]);
      return invoice ? send(200, invoice) : error(400, "The id provided does not exist");
    }
    if (req.method === "GET" && url.pathname === "/v1/invoices") {
      const subscriptionId = url.searchParams.get("subscription_id");
      const items = [...this.invoices.values()].filter((invoice) => invoice.subscription_id === subscriptionId);
      return send(200, { entity: "collection", count: items.length, items });
    }
    if (req.method === "GET" && (match = /^\/v1\/payments\/([\w]+)$/.exec(url.pathname))) {
      const payment = this.payments.get(match[1]);
      return payment ? send(200, payment) : error(400, "The id provided does not exist");
    }
    if (req.method === "GET" && (match = /^\/v1\/payments\/([\w]+)\/refunds$/.exec(url.pathname))) {
      const items = this.refunds.get(match[1]) ?? [];
      return send(200, { entity: "collection", count: items.length, items });
    }
    return error(404, `fake razorpay: no route for ${req.method} ${url.pathname}`);
  }
}
