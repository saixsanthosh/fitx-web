// Before the billing migration is applied, nothing may break and nothing may pretend: the routes answer
// with "not available" states and Razorpay is never called.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import "./support/server-only.mjs";
import { SESSION_COOKIE, ssrCookieValue } from "../support/fake-supabase.ts";
import { FakeRazorpay } from "./support/fake-razorpay.ts";
import { PgRest, type TestUser } from "./support/pg-rest.ts";
import { addUser, TestDatabase } from "./support/pg.ts";
import { paymentEntity, signBody, subscriptionEntity, webhookBody } from "./support/razorpay-payloads.ts";

const KEY_ID = "rzp_test_FitxBefore01";
const KEY_SECRET = "before-key-secret";
const WEBHOOK_SECRET = "before-webhook-secret";
const MEMBER: TestUser = { id: "55555555-5555-4555-8555-555555555555", email: "member@example.test" };

describe("billing before the migration is applied", { skip: TestDatabase.available() ? false : "PostgreSQL is not installed" }, () => {
  let db: TestDatabase;
  let rest: PgRest;
  let razorpay: FakeRazorpay;
  let NextRequest: typeof import("next/server").NextRequest;
  type Handler = (request: InstanceType<typeof import("next/server").NextRequest>) => Promise<Response>;
  let routes: { checkout: Handler; status: Handler; cancel: Handler; webhook: Handler };

  before(async () => {
    db = await TestDatabase.start({ migrate: false });
    rest = await new PgRest(db, "before-service-key").start();
    razorpay = await new FakeRazorpay(KEY_ID, KEY_SECRET).start();
    await addUser(db, MEMBER.id, MEMBER.email);
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: rest.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "before-anon-key",
      SUPABASE_SECRET_KEY: "before-service-key",
      RAZORPAY_KEY_ID: KEY_ID,
      RAZORPAY_KEY_SECRET: KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      RAZORPAY_API_BASE: razorpay.url,
      BILLING_TEST_EMAILS: MEMBER.email,
    });
    delete process.env.VERCEL_ENV;
    ({ NextRequest } = await import("next/server"));
    routes = {
      checkout: (await import("@/app/api/billing/checkout/route")).POST,
      status: (await import("@/app/api/billing/status/route")).GET,
      cancel: (await import("@/app/api/billing/cancel/route")).POST,
      webhook: (await import("@/app/api/billing/webhook/route")).POST,
    };
  });
  after(async () => {
    await rest?.stop();
    await razorpay?.stop();
    await db?.stop();
  });

  const signedIn = (path: string, method = "GET", body?: unknown) =>
    new NextRequest(new URL(path, "https://fitnessx.vercel.app"), {
      method,
      headers: {
        host: "fitnessx.vercel.app",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "same-origin",
        cookie: `${SESSION_COOKIE}=${ssrCookieValue(rest.session(MEMBER))}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  test("status says nothing is installed instead of failing", async () => {
    const response = await routes.status(signedIn("/api/billing/status"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { premium: false, subscription: null, installed: false });
  });

  test("checkout and cancel answer 'unavailable' and never call Razorpay", async () => {
    const checkout = await routes.checkout(signedIn("/api/billing/checkout", "POST", { plan: "premium-monthly" }));
    assert.equal(checkout.status, 503);
    assert.deepEqual(await checkout.json(), { error: "unavailable" });
    const cancel = await routes.cancel(signedIn("/api/billing/cancel", "POST"));
    assert.equal(cancel.status, 503);
    assert.equal(razorpay.calls.length, 0);
  });

  test("a signed webhook is refused with a retryable status, so Razorpay redelivers it after the migration", async () => {
    const raw = JSON.stringify(
      webhookBody("subscription.charged", {
        subscription: subscriptionEntity({ id: "sub_BeforeMigrate1", plan_id: "plan_BeforeMigrate", status: "active" }),
        payment: paymentEntity({ id: "pay_BeforeMigrate1", amount: 19900, status: "captured" }),
      }),
    );
    const response = await routes.webhook(
      new NextRequest("https://fitnessx.vercel.app/api/billing/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-razorpay-signature": signBody(raw, WEBHOOK_SECRET), "x-razorpay-event-id": "evt_BeforeMigrate1" },
        body: raw,
      }),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "billing_not_installed" });
  });
});
