import { describe, test } from "node:test";
import assert from "node:assert/strict";
import "./support/server-only.mjs";

const { billingCyclesForTenYears, formatAmount, formatInr, periodLabel, periodLength } = await import("@/lib/billing/money");
const { checkoutAllowedFor, modeOfKey, parseEmailList, readBillingConfig, RAZORPAY_API_BASE } = await import("@/lib/billing/config");
const { formatBillingDate, formatPaidThrough, paymentStatusLabel, subscriptionStatusLabel } = await import("@/lib/billing/status");
const { pickCurrentSubscription, toSubscriptionView } = await import("@/lib/billing/view");
const { checkoutRetryAfterSeconds, CHECKOUTS_PER_DAY, planMismatch } = await import("@/lib/billing/checkout");

describe("money", () => {
  test("formats paise as Indian rupees", () => {
    assert.equal(formatInr(19900), "₹199");
    assert.equal(formatInr(19950), "₹199.50");
    assert.equal(formatInr(14999900), "₹1,49,999");
    assert.equal(formatInr(0), "₹0");
    assert.equal(formatInr(Number.NaN), "—");
    assert.match(formatAmount(1000, "USD"), /10/);
  });

  test("describes billing periods", () => {
    assert.equal(periodLabel("monthly"), "per month");
    assert.equal(periodLabel("monthly", 3), "every 3 months");
    assert.equal(periodLabel("yearly"), "per year");
    assert.equal(periodLength("monthly", 6), "6 months");
  });

  test("bills for at most ten years, as Razorpay allows", () => {
    assert.equal(billingCyclesForTenYears("monthly"), 120);
    assert.equal(billingCyclesForTenYears("monthly", 3), 40);
    assert.equal(billingCyclesForTenYears("monthly", 12), 10);
    assert.equal(billingCyclesForTenYears("yearly"), 10);
  });
});

describe("configuration", () => {
  const complete = {
    RAZORPAY_KEY_ID: "rzp_test_FitxLocal123",
    RAZORPAY_KEY_SECRET: "secret",
    RAZORPAY_WEBHOOK_SECRET: "whsec",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_x",
  };

  test("stays closed until every secret is present", () => {
    assert.deepEqual(readBillingConfig({}), { ok: false, reason: "razorpay_keys_missing" });
    assert.deepEqual(readBillingConfig({ ...complete, RAZORPAY_KEY_SECRET: " " }), { ok: false, reason: "razorpay_keys_missing" });
    assert.deepEqual(readBillingConfig({ ...complete, RAZORPAY_KEY_ID: "pk_live_123" }), { ok: false, reason: "razorpay_key_invalid" });
    assert.deepEqual(readBillingConfig({ ...complete, RAZORPAY_WEBHOOK_SECRET: "" }), { ok: false, reason: "webhook_secret_missing" });
    assert.deepEqual(readBillingConfig({ ...complete, SUPABASE_SECRET_KEY: "" }), { ok: false, reason: "server_key_missing" });
    const ready = readBillingConfig({ ...complete, SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "legacy" });
    assert.equal(ready.ok, true);
  });

  test("derives test or live mode from the key id", () => {
    assert.equal(modeOfKey("rzp_test_abc123"), "test");
    assert.equal(modeOfKey("rzp_live_abc123"), "live");
    assert.equal(modeOfKey("rzp_abc"), null);
    const config = readBillingConfig({ ...complete, RAZORPAY_KEY_ID: "rzp_live_FitxLive1" });
    assert.equal(config.ok && config.config.mode, "live");
  });

  test("only lets loopback URLs replace the Razorpay API address", () => {
    const local = readBillingConfig({ ...complete, RAZORPAY_API_BASE: "http://127.0.0.1:4010/v1/" });
    assert.equal(local.ok && local.config.apiBase, "http://127.0.0.1:4010/v1");
    for (const other of ["https://evil.example/v1", "http://10.0.0.1/v1", "ftp://127.0.0.1/v1", "not a url"]) {
      const config = readBillingConfig({ ...complete, RAZORPAY_API_BASE: other });
      assert.equal(config.ok && config.config.apiBase, RAZORPAY_API_BASE, other);
    }
  });

  test("test mode is limited to BILLING_TEST_EMAILS; live mode is open", () => {
    const test = readBillingConfig({ ...complete, BILLING_TEST_EMAILS: "Owner@Example.test, tester@example.test;bad" });
    assert.ok(test.ok);
    assert.deepEqual([...parseEmailList("a@x.in  b@y.in,c")], ["a@x.in", "b@y.in"]);
    assert.equal(checkoutAllowedFor(test.config, "owner@example.test"), true);
    assert.equal(checkoutAllowedFor(test.config, "stranger@example.test"), false);
    assert.equal(checkoutAllowedFor(test.config, null), false);
    const live = readBillingConfig({ ...complete, RAZORPAY_KEY_ID: "rzp_live_FitxLive1" });
    assert.ok(live.ok);
    assert.equal(checkoutAllowedFor(live.config, "stranger@example.test"), true);
  });
});

describe("labels and dates", () => {
  test("uses plain words for statuses", () => {
    assert.equal(subscriptionStatusLabel("pending"), "Renewal being retried");
    assert.equal(paymentStatusLabel("captured", 0), "Paid");
    assert.equal(paymentStatusLabel("captured", 500), "Partly refunded");
  });

  test("formats dates in India Standard Time", () => {
    assert.equal(formatBillingDate("2026-11-30T20:00:00Z"), "1 Dec 2026");
    assert.equal(formatBillingDate(null), null);
    assert.equal(formatBillingDate("nonsense"), null);
  });

  test("a paid period ending at 00:00 India time is shown through the day before", () => {
    // Razorpay ends cycles at midnight IST: 18:30 UTC on 5 Dec is 00:00 on 6 Dec in India.
    assert.equal(formatPaidThrough("2026-12-05T18:30:00Z"), "5 Dec 2026");
    assert.equal(formatPaidThrough("2026-12-06T09:00:00Z"), "6 Dec 2026");
    assert.equal(formatPaidThrough(null), null);
    assert.equal(formatPaidThrough("nonsense"), null);
  });
});

describe("which subscription the page shows", () => {
  const base = { planId: "p", planName: "Premium", amountPaise: 19900, period: "monthly" as const, interval: 1, mode: "test" as const, chargeAt: null, cancelRequestedAt: null };
  const now = Date.parse("2026-11-17T00:00:00Z");

  test("prefers one Razorpay still bills, then one still paid for, and skips unpaid checkouts", () => {
    const rows = [
      { ...base, id: "unpaid", status: "created" as const, paidCount: 0, paidUntil: null, createdAt: "2026-11-16T00:00:00Z" },
      { ...base, id: "ended", status: "cancelled" as const, paidCount: 1, paidUntil: "2026-12-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" },
      { ...base, id: "live", status: "pending" as const, paidCount: 2, paidUntil: "2026-11-10T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" },
    ];
    assert.equal(pickCurrentSubscription(rows, now)?.id, "live");
    assert.equal(pickCurrentSubscription(rows.filter((row) => row.id !== "live"), now)?.id, "ended");
    assert.equal(pickCurrentSubscription(rows.filter((row) => row.id === "unpaid"), now), null);
  });

  test("the renewal price is the subscription's own, not the plan row's current one", () => {
    const row = {
      id: "s1", plan_id: "p1", mode: "live" as const, status: "active", amount_paise: 19900, billing_period: "monthly" as const, billing_interval: 1,
      paid_count: 3, paid_until: "2026-12-01T00:00:00Z", charge_at: "2026-12-01T00:00:00Z", cancel_requested_at: null, abandoned_at: null,
      created_at: "2026-09-01T00:00:00Z", billing_plans: { name: "Premium monthly", amount_paise: 29900, billing_period: "monthly" as const, billing_interval: 1 },
    };
    assert.deepEqual(
      (({ amountPaise, period, interval, planName }) => ({ amountPaise, period, interval, planName }))(toSubscriptionView(row)!),
      { amountPaise: 19900, period: "monthly", interval: 1, planName: "Premium monthly" },
    );
    const older = { ...row, amount_paise: null, billing_period: null, billing_interval: null };
    assert.equal(toSubscriptionView(older)!.amountPaise, 29900, "rows without a stored price fall back to the plan");
  });

  test("a checkout that expired or was cancelled before any charge is not shown as a subscription", () => {
    const expired = { ...base, id: "expired", status: "expired" as const, paidCount: 0, paidUntil: null, createdAt: "2026-11-16T00:00:00Z" };
    const refunded = { ...base, id: "refunded", status: "cancelled" as const, paidCount: 1, paidUntil: null, createdAt: "2026-10-01T00:00:00Z" };
    assert.equal(pickCurrentSubscription([expired], now), null);
    assert.equal(pickCurrentSubscription([{ ...expired, status: "cancelled" as const }], now), null);
    assert.equal(pickCurrentSubscription([expired, refunded], now)?.id, "refunded", "a paid, fully refunded one still is");
  });
});

describe("plan check before checkout", () => {
  const plan = {
    id: "1", code: "premium-monthly", name: "Premium", description: null, features: [], amount_paise: 19900, currency: "INR",
    billing_period: "monthly" as const, billing_interval: 1, razorpay_plan_id_test: "plan_TestMonthly01", razorpay_plan_id_live: null, is_active: true, sort_order: 0,
  };
  const remote = { id: "plan_TestMonthly01", period: "monthly", interval: 1, item: { amount: 19900, currency: "INR" } };

  test("passes only when Razorpay charges exactly what FITX shows", () => {
    assert.equal(planMismatch(plan, remote, "plan_TestMonthly01"), null);
    assert.equal(planMismatch(plan, { ...remote, item: { amount: 29900, currency: "INR" } }, "plan_TestMonthly01"), "amount");
    assert.equal(planMismatch(plan, { ...remote, period: "yearly" }, "plan_TestMonthly01"), "period");
    assert.equal(planMismatch(plan, { ...remote, interval: 3 }, "plan_TestMonthly01"), "interval");
    assert.equal(planMismatch(plan, { ...remote, item: { amount: 19900, currency: "USD" } }, "plan_TestMonthly01"), "currency");
    assert.equal(planMismatch(plan, remote, "plan_Other0000001"), "plan id");
  });
});

describe("daily checkout limit", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const hoursAgo = (hours: number) => ({ created_at: new Date(now.getTime() - hours * 3_600_000).toISOString() });

  test("counts only checkouts started in the last 24 hours", () => {
    assert.equal(CHECKOUTS_PER_DAY, 10);
    assert.equal(checkoutRetryAfterSeconds(Array.from({ length: 9 }, (_, i) => hoursAgo(i)), now), null);
    assert.equal(checkoutRetryAfterSeconds([...Array.from({ length: 9 }, (_, i) => hoursAgo(i)), hoursAgo(25)], now), null);
  });

  test("says when the oldest counted checkout stops counting", () => {
    const rows = Array.from({ length: 10 }, (_, i) => hoursAgo(i * 2)); // the oldest is 18 hours old
    assert.equal(checkoutRetryAfterSeconds(rows, now), 6 * 60 * 60);
  });
});
