// The billing route handlers end to end: Next request -> route -> supabase-js -> a PostgREST-compatible
// test server -> the real billing SQL in PostgreSQL, with a fake Razorpay API. Covers checkout, the
// display-only verification, signed webhooks (idempotency, ordering, invoice linking, retries, modes),
// status, cancellation and nightly reconciliation.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import "./support/server-only.mjs";
import { SESSION_COOKIE, ssrCookieValue } from "../support/fake-supabase.ts";
import { FakeRazorpay } from "./support/fake-razorpay.ts";
import { PgRest, type TestUser } from "./support/pg-rest.ts";
import { addPlan, addUser, lit, TestDatabase } from "./support/pg.ts";
import { DAY, invoiceEntity, paymentEntity, refundEntity, signBody, subscriptionEntity, unix, webhookBody } from "./support/razorpay-payloads.ts";

const KEY_ID = "rzp_test_FitxLocal123";
const KEY_SECRET = "test-key-secret-value";
const WEBHOOK_SECRET = "whsec-test-secret-value";
const SERVICE_KEY = "test-service-key-value";
const CRON_SECRET = "cron-test-secret-value";
const MONTHLY = "plan_TestMonthly01";
const YEARLY = "plan_TestYearly001";

const MEMBER: TestUser = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.test", name: "Test Member" };
const SECOND: TestUser = { id: "22222222-2222-4222-8222-222222222222", email: "second@example.test" };
const STRANGER: TestUser = { id: "33333333-3333-4333-8333-333333333333", email: "stranger@example.test" };

type AppRequest = InstanceType<typeof import("next/server").NextRequest>;
type Route = { POST?: (request: AppRequest) => Promise<Response>; GET?: (request: AppRequest) => Promise<Response> };

describe("billing API routes end to end", { skip: TestDatabase.available() ? false : "PostgreSQL is not installed" }, () => {
  let db: TestDatabase;
  let rest: PgRest;
  let razorpay: FakeRazorpay;
  let NextRequest: typeof import("next/server").NextRequest;
  const routes: Record<"checkout" | "verify" | "cancel" | "status" | "webhook" | "reconcile", Route> = {} as never;
  let memberSubscription = "";
  let secondSubscription = "";
  const PERIOD_START = unix(Date.now()) - DAY;
  const PERIOD_END = PERIOD_START + 30 * DAY;

  before(async () => {
    db = await TestDatabase.start();
    rest = await new PgRest(db, SERVICE_KEY).start();
    razorpay = await new FakeRazorpay(KEY_ID, KEY_SECRET).start();
    razorpay.addPlan(MONTHLY, 19900, "monthly");
    razorpay.addPlan(YEARLY, 199900, "yearly");
    for (const user of [MEMBER, SECOND, STRANGER]) await addUser(db, user.id, user.email);
    await addPlan(db, { code: "premium-monthly", name: "Premium monthly", amount: 19900, period: "monthly", testPlanId: MONTHLY });
    await addPlan(db, { code: "premium-yearly", name: "Premium yearly", amount: 199900, period: "yearly", testPlanId: YEARLY });

    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: rest.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SECRET_KEY: SERVICE_KEY,
      RAZORPAY_KEY_ID: KEY_ID,
      RAZORPAY_KEY_SECRET: KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      RAZORPAY_API_BASE: razorpay.url,
      CRON_SECRET,
      BILLING_TEST_EMAILS: "member@example.test, second@example.test",
    });
    delete process.env.VERCEL_ENV;
    ({ NextRequest } = await import("next/server"));
    routes.checkout = await import("@/app/api/billing/checkout/route");
    routes.verify = await import("@/app/api/billing/verify/route");
    routes.cancel = await import("@/app/api/billing/cancel/route");
    routes.status = await import("@/app/api/billing/status/route");
    routes.webhook = await import("@/app/api/billing/webhook/route");
    routes.reconcile = await import("@/app/api/billing/reconcile/route");
  });

  after(async () => {
    await rest?.stop();
    await razorpay?.stop();
    await db?.stop();
  });

  function appRequest(path: string, { user, method = "GET", body, site = "same-origin" }: { user?: TestUser; method?: string; body?: unknown; site?: string } = {}) {
    const headers: Record<string, string> = { host: "fitnessx.vercel.app", "x-forwarded-proto": "https", "sec-fetch-site": site };
    if (user) headers.cookie = `${SESSION_COOKIE}=${ssrCookieValue(rest.session(user))}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    return new NextRequest(new URL(path, "https://fitnessx.vercel.app"), { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  async function call(route: Route, method: "GET" | "POST", request: AppRequest) {
    const response = await route[method]!(request);
    return { status: response.status, body: (await response.json()) as Record<string, unknown>, headers: response.headers };
  }
  const checkout = (user: TestUser | undefined, plan: string, site?: string) =>
    call(routes.checkout, "POST", appRequest("/api/billing/checkout", { user, method: "POST", body: { plan }, site }));
  const status = (user: TestUser) => call(routes.status, "GET", appRequest("/api/billing/status", { user }));
  function deliver(event: unknown, { eventId, signature, raw }: { eventId?: string; signature?: string; raw?: string } = {}) {
    const body = raw ?? JSON.stringify(event);
    const headers: Record<string, string> = { "content-type": "application/json", "x-razorpay-signature": signature ?? signBody(body, WEBHOOK_SECRET) };
    if (eventId) headers["x-razorpay-event-id"] = eventId;
    return call(routes.webhook, "POST", new NextRequest("https://fitnessx.vercel.app/api/billing/webhook", { method: "POST", headers, body }));
  }
  const rowsFor = (subscriptionId: string) =>
    db.rows<{ status: string; abandoned: boolean; requested: boolean; paid_until: string | null }>(
      `select status, abandoned_at is not null as abandoned, cancel_requested_at is not null as requested, paid_until from public.billing_subscriptions where provider_subscription_id = ${lit(subscriptionId)}`,
    );
  const eventCount = (eventId: string) => db.value<number>(`select count(*) from public.billing_provider_events where event_id = ${lit(eventId)}`);

  test("checkout needs a signed-in account and a request from FITX itself", async () => {
    assert.equal((await checkout(undefined, "premium-monthly")).status, 401);
    assert.equal((await checkout(MEMBER, "premium-monthly", "cross-site")).status, 403);
    assert.equal((await checkout(MEMBER, "Not a plan!")).status, 400);
    assert.equal(razorpay.calls.length, 0);
  });

  test("in test mode only BILLING_TEST_EMAILS can check out", async () => {
    const result = await checkout(STRANGER, "premium-monthly");
    assert.equal(result.status, 503);
    assert.equal(result.body.error, "unavailable");
    assert.equal(razorpay.calls.length, 0);
  });

  test("an unknown plan is refused", async () => {
    assert.deepEqual((await checkout(MEMBER, "premium-weekly")).body, { error: "plan_not_found" });
  });

  test("checkout is refused when Razorpay would charge a different amount than FITX shows", async () => {
    const plan = razorpay.plans.get(MONTHLY)!;
    razorpay.plans.set(MONTHLY, { ...plan, item: { ...(plan.item as object), amount: 29900 } });
    const result = await checkout(MEMBER, "premium-monthly");
    razorpay.plans.set(MONTHLY, plan);
    assert.equal(result.status, 503);
    assert.equal(razorpay.callsTo("POST", /^\/v1\/subscriptions$/).length, 0);
    assert.equal(await db.value(`select count(*) from public.billing_subscriptions where user_id = ${lit(MEMBER.id)}`), 0);
  });

  test("checkout creates the Razorpay subscription, records it, and sends no secret to the browser", async () => {
    const result = await checkout(MEMBER, "premium-monthly");
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    const session = result.body.checkout as Record<string, unknown>;
    memberSubscription = String(session.subscriptionId);
    assert.match(memberSubscription, /^sub_/);
    assert.equal(session.keyId, KEY_ID);
    assert.equal(session.mode, "test");
    assert.deepEqual(session.prefill, { email: MEMBER.email, name: MEMBER.name });
    assert.deepEqual(session.plan, { code: "premium-monthly", name: "Premium monthly", amountPaise: 19900, period: "monthly", interval: 1 });
    const text = JSON.stringify(result.body);
    for (const secret of [KEY_SECRET, WEBHOOK_SECRET, SERVICE_KEY, CRON_SECRET]) assert.equal(text.includes(secret), false);

    const [create] = razorpay.callsTo("POST", /^\/v1\/subscriptions$/);
    assert.equal(create.authorization, razorpay.expectedAuthorization);
    assert.deepEqual(create.body, {
      plan_id: MONTHLY,
      total_count: 120,
      quantity: 1,
      customer_notify: true,
      notes: { fitx_user_id: MEMBER.id, fitx_plan: "premium-monthly" },
    });
    assert.deepEqual(await rowsFor(memberSubscription), [{ status: "created", abandoned: false, requested: false, paid_until: null }]);
    assert.deepEqual((await status(MEMBER)).body, { premium: false, subscription: { status: "created", paidUntil: null, chargeAt: null } });
  });

  test("a second click reuses the unpaid checkout instead of creating another", async () => {
    const again = await checkout(MEMBER, "premium-monthly");
    assert.equal((again.body.checkout as Record<string, unknown>).subscriptionId, memberSubscription);
    assert.equal(razorpay.callsTo("POST", /^\/v1\/subscriptions$/).length, 1);
  });

  test("switching plans before paying abandons the earlier checkout", async () => {
    const monthly = String(((await checkout(SECOND, "premium-monthly")).body.checkout as Record<string, unknown>).subscriptionId);
    secondSubscription = String(((await checkout(SECOND, "premium-yearly")).body.checkout as Record<string, unknown>).subscriptionId);
    assert.notEqual(monthly, secondSubscription);
    assert.equal((await rowsFor(monthly))[0].abandoned, true);
    assert.equal((await rowsFor(secondSubscription))[0].abandoned, false);
  });

  test("verify checks Checkout's signature for this account only, and changes nothing", async () => {
    const paymentId = "pay_TestMember0001";
    const valid = { razorpay_payment_id: paymentId, razorpay_subscription_id: memberSubscription, razorpay_signature: signBody(`${paymentId}|${memberSubscription}`, KEY_SECRET) };
    const verify = (user: TestUser, body: unknown) => call(routes.verify, "POST", appRequest("/api/billing/verify", { user, method: "POST", body }));
    assert.deepEqual((await verify(MEMBER, valid)).body, { verified: true });
    assert.deepEqual((await verify(MEMBER, { ...valid, razorpay_signature: signBody(`${paymentId}|${memberSubscription}`, WEBHOOK_SECRET) })).body, { verified: false });
    assert.deepEqual((await verify(STRANGER, valid)).body, { verified: false });
    assert.equal((await rowsFor(memberSubscription))[0].status, "created");
    assert.equal((await status(MEMBER)).body.premium, false);
  });

  const chargedEvent = (createdAt: number) =>
    webhookBody(
      "subscription.charged",
      {
        subscription: subscriptionEntity({ id: memberSubscription, plan_id: MONTHLY, status: "active", current_start: PERIOD_START, current_end: PERIOD_END, charge_at: PERIOD_END, paid_count: 1, remaining_count: 119 }),
        payment: paymentEntity({ id: "pay_TestMember0001", amount: 19900, status: "captured", invoice_id: "inv_TestMember001" }),
      },
      createdAt,
    );

  test("a webhook with a bad signature is rejected before anything is read or written", async () => {
    const event = chargedEvent(unix(Date.now()));
    const result = await deliver(event, { eventId: "evt_BadSignature1", signature: signBody(JSON.stringify(event), "not-the-secret") });
    assert.equal(result.status, 400);
    assert.equal(await eventCount("evt_BadSignature1"), 0);
    assert.equal((await deliver(event, { eventId: "evt_BadSignature2", signature: "" })).status, 400);
  });

  test("subscription.charged turns Premium on; a redelivery changes nothing", async () => {
    razorpay.subscriptions.set(memberSubscription, { ...razorpay.subscriptions.get(memberSubscription)!, status: "active", current_start: PERIOD_START, current_end: PERIOD_END, charge_at: PERIOD_END, paid_count: 1 });
    const event = chargedEvent(unix(Date.now()));
    const first = await deliver(event, { eventId: "evt_MemberCharged1" });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { outcome: "applied" });
    const now = await status(MEMBER);
    assert.equal(now.body.premium, true);
    assert.equal((now.body.subscription as Record<string, unknown>).status, "active");
    assert.deepEqual((await deliver(event, { eventId: "evt_MemberCharged1" })).body, { outcome: "duplicate" });
    assert.equal(await db.value(`select count(*) from public.billing_payments where provider_payment_id = 'pay_TestMember0001'`), 1);
    const stored = await db.value<string>(`select payload::text from public.billing_provider_events where event_id = 'evt_MemberCharged1'`);
    assert.equal(stored.includes("payer@example.test") || stored.includes("+919999999999"), false, "no contact details stored");
  });

  test("an older event delivered late does not undo the newer state", async () => {
    const late = webhookBody("subscription.authenticated", { subscription: subscriptionEntity({ id: memberSubscription, plan_id: MONTHLY, status: "authenticated" }) }, unix(Date.now()) - 3600);
    assert.deepEqual((await deliver(late, { eventId: "evt_MemberLateAuth" })).body, { outcome: "applied", detail: "older_than_applied_snapshot" });
    assert.equal((await rowsFor(memberSubscription))[0].status, "active");
  });

  test("payment.failed is linked to its subscription through the invoice", async () => {
    razorpay.invoices.set("inv_TestRenewal01", invoiceEntity({ id: "inv_TestRenewal01", subscription_id: memberSubscription, payment_id: null, billing_start: PERIOD_END, billing_end: PERIOD_END + 30 * DAY }));
    const failed = webhookBody("payment.failed", {
      payment: paymentEntity({ id: "pay_TestFailed001", amount: 19900, status: "failed", invoice_id: "inv_TestRenewal01", error_code: "BAD_REQUEST_ERROR", error_description: "Payment declined by the bank", error_reason: "payment_declined" }),
    });

    razorpay.dropNext = /^\/v1\/invoices\/inv_TestRenewal01$/;
    const outage = await deliver(failed, { eventId: "evt_MemberFailed01" });
    assert.equal(outage.status, 503, "Razorpay is asked to retry while the invoice cannot be read");
    assert.equal(await eventCount("evt_MemberFailed01"), 0);

    assert.deepEqual((await deliver(failed, { eventId: "evt_MemberFailed01" })).body, { outcome: "applied" });
    assert.equal(razorpay.callsTo("GET", /^\/v1\/invoices\/inv_TestRenewal01$/).length, 2);
    assert.deepEqual(
      await db.rows(`select p.status, p.error_description, s.provider_subscription_id from public.billing_payments p join public.billing_subscriptions s on s.id = p.subscription_id where p.provider_payment_id = 'pay_TestFailed001'`),
      [{ status: "failed", error_description: "Payment declined by the bank", provider_subscription_id: memberSubscription }],
    );
    assert.equal((await status(MEMBER)).body.premium, true, "a failed attempt neither extends nor cuts the paid period");
  });

  test("events FITX does not act on are acknowledged without being stored", async () => {
    assert.deepEqual((await deliver(webhookBody("order.paid", {}), { eventId: "evt_OrderPaid0001" })).body, { outcome: "ignored", detail: "unhandled_event" });
    assert.equal(await eventCount("evt_OrderPaid0001"), 0);
    assert.equal((await deliver(null, { raw: "{not json", eventId: "evt_NotJson00001" })).status, 400);
  });

  test("a live-mode server refuses test-mode records so Razorpay retries instead of losing them", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_FitxLive123";
    try {
      const result = await deliver(chargedEvent(unix(Date.now())), { eventId: "evt_ModeMismatch1" });
      assert.equal(result.status, 409);
      assert.equal(await eventCount("evt_ModeMismatch1"), 0);
    } finally {
      process.env.RAZORPAY_KEY_ID = KEY_ID;
    }
  });

  test("status reports only the signed-in account", async () => {
    assert.equal((await status(SECOND)).body.premium, false);
    assert.equal((await call(routes.status, "GET", appRequest("/api/billing/status"))).status, 401);
  });

  test("cancel stops renewals at Razorpay and keeps Premium until the paid period ends", async () => {
    assert.equal((await call(routes.cancel, "POST", appRequest("/api/billing/cancel", { user: MEMBER, method: "POST", site: "cross-site" }))).status, 403);
    const result = await call(routes.cancel, "POST", appRequest("/api/billing/cancel", { user: MEMBER, method: "POST" }));
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "cancelled");
    assert.equal(Date.parse(String(result.body.accessUntil)), PERIOD_END * 1000);
    const [cancel] = razorpay.callsTo("POST", /\/cancel$/);
    assert.deepEqual(cancel.body, { cancel_at_cycle_end: false });
    const [row] = await rowsFor(memberSubscription);
    assert.deepEqual({ status: row.status, requested: row.requested }, { status: "cancelled", requested: true });
    assert.equal(Date.parse(String(row.paid_until)), PERIOD_END * 1000);
    assert.equal((await status(MEMBER)).body.premium, true);
    assert.deepEqual((await call(routes.cancel, "POST", appRequest("/api/billing/cancel", { user: MEMBER, method: "POST" }))).body, { error: "nothing_to_cancel" });
  });

  test("reconciliation needs the cron secret", async () => {
    const reconcile = (authorization?: string) =>
      call(routes.reconcile, "GET", new NextRequest("https://fitnessx.vercel.app/api/billing/reconcile", { headers: authorization ? { authorization } : {} }));
    assert.equal((await reconcile()).status, 401);
    assert.equal((await reconcile("Bearer wrong")).status, 401);
    assert.equal((await reconcile(CRON_SECRET)).status, 401);
  });

  test("reconciliation repairs a payment and a refund whose webhooks never arrived", async () => {
    // SECOND paid for the yearly plan, but no webhook reached FITX.
    const start = unix(Date.now()) - 3600;
    const end = start + 365 * DAY;
    razorpay.subscriptions.set(secondSubscription, { ...razorpay.subscriptions.get(secondSubscription)!, status: "active", current_start: start, current_end: end, charge_at: end, paid_count: 1, customer_id: "cust_TestSecond001" });
    razorpay.invoices.set("inv_TestSecond001", invoiceEntity({ id: "inv_TestSecond001", subscription_id: secondSubscription, payment_id: "pay_TestSecond001", amount: 199900, billing_start: start, billing_end: end }));
    razorpay.payments.set("pay_TestSecond001", paymentEntity({ id: "pay_TestSecond001", amount: 199900, status: "captured", method: "upi", invoice_id: "inv_TestSecond001" }));
    // MEMBER was partly refunded from the Razorpay Dashboard; that webhook was missed too.
    razorpay.invoices.set("inv_TestMember001", invoiceEntity({ id: "inv_TestMember001", subscription_id: memberSubscription, payment_id: "pay_TestMember0001", billing_start: PERIOD_START, billing_end: PERIOD_END }));
    razorpay.payments.set("pay_TestMember0001", paymentEntity({ id: "pay_TestMember0001", amount: 19900, status: "captured", amount_refunded: 5000, refund_status: "partial" }));
    razorpay.refunds.set("pay_TestMember0001", [refundEntity({ id: "rfnd_TestMember001", payment_id: "pay_TestMember0001", amount: 5000, status: "processed" })]);

    const result = await call(routes.reconcile, "GET", new NextRequest("https://fitnessx.vercel.app/api/billing/reconcile", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
    assert.equal(result.status, 200);
    assert.equal(result.body.mode, "test");
    assert.equal(result.body.errors, 0);
    assert.ok(Number(result.body.checked) >= 2);
    assert.ok(Number(result.body.corrections) >= 3, JSON.stringify(result.body));

    assert.equal((await rowsFor(secondSubscription))[0].status, "active");
    assert.equal((await status(SECOND)).body.premium, true);
    assert.deepEqual(await db.rows(`select status, amount_paise, period_end is not null as has_period from public.billing_payments where provider_payment_id = 'pay_TestSecond001'`), [
      { status: "captured", amount_paise: 199900, has_period: true },
    ]);
    assert.deepEqual(await db.rows(`select status, amount_paise from public.billing_refunds where provider_refund_id = 'rfnd_TestMember001'`), [{ status: "processed", amount_paise: 5000 }]);
    assert.equal(await db.value(`select count(*) from public.billing_reconciliation_runs where mode = 'test'`), 1);

    // A second run finds nothing new to correct.
    const again = await call(routes.reconcile, "GET", new NextRequest("https://fitnessx.vercel.app/api/billing/reconcile", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
    assert.equal(again.body.corrections, 0, JSON.stringify(again.body));
  });
});
