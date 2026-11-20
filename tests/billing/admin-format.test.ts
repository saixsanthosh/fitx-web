import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  count,
  formatInr,
  lastCoveredInstant,
  formatSignedInr,
  monthLabel,
  netPaise,
  parseMode,
  parseOverview,
  parsePage,
  parsePaymentFilter,
  parsePayments,
  parsePlans,
  parseSubscribers,
  paymentLabel,
  parsePlanDetail,
  razorpayPaymentUrl,
  canRefund,
} from "../../admin/src/app/(control)/billing/format.ts";

const overview = {
  mode: "live",
  subscribers_with_access: 3,
  subscriptions_by_status: { active: 2, cancelled: "1" },
  captured_paise_total: "59700",
  refunded_paise_total: 19900,
  fees_paise_total: 1410,
  captured_paise_month: 39800,
  refunded_paise_month: 0,
  payments_captured_30d: 2,
  payments_failed_30d: 1,
  refunds_pending: 0,
  webhooks_ignored_30d: 0,
  last_webhook_at: "2026-11-16T10:00:00+05:30",
  last_reconciliation: { finished_at: "2026-11-16T02:00:00+05:30", subscriptions_checked: 3, corrections: 1, errors: 0 },
  monthly: [{ month: "2026-11", captured_paise: 39800, refunded_paise: 0 }, { month: "2026-10", captured_paise: 19900, refunded_paise: 19900 }],
};

describe("Admin billing overview", () => {
  test("reads totals from the database function, numbers or numeric strings", () => {
    const parsed = parseOverview(overview);
    assert.ok(parsed);
    assert.equal(parsed.capturedTotal, 59700);
    assert.equal(parsed.subscriptionsByStatus.cancelled, 1);
    assert.equal(parsed.lastReconciliation?.corrections, 1);
    assert.equal(parsed.monthly.length, 2);
  });

  test("revenue is captured minus refunded", () => {
    const parsed = parseOverview(overview)!;
    assert.equal(netPaise(parsed.capturedTotal, parsed.refundedTotal), 39800);
    assert.equal(formatSignedInr(netPaise(0, 19900)), "−₹199");
    assert.equal(formatInr(39800), "₹398");
  });

  test("refuses anything that is not a whole, non-negative amount instead of showing it", () => {
    assert.equal(parseOverview({ ...overview, captured_paise_total: -1 }), null);
    assert.equal(parseOverview({ ...overview, refunded_paise_total: "12.5" }), null);
    assert.equal(parseOverview({ ...overview, payments_failed_30d: null }), null);
    assert.equal(parseOverview({ ...overview, monthly: [{ month: "Nov", captured_paise: 1, refunded_paise: 0 }] }), null);
    assert.equal(parseOverview(null), null);
    assert.equal(count("007"), 7);
    assert.equal(count(1.5), null);
  });
});

describe("Admin billing rows and query parameters", () => {
  test("rows carry the total for paging", () => {
    const subscribers = parseSubscribers([{ id: "1", email: null, plan_name: "Premium", amount_paise: 19900, billing_period: "monthly", billing_interval: 1, status: "active", has_access: true, total_rows: 41 }]);
    assert.equal(subscribers.total, 41);
    assert.equal(subscribers.rows[0].email, null);
    assert.equal(parsePayments([]).total, 0);
    assert.deepEqual(parsePlans([{ code: "m", name: "M", amount_paise: 100, billing_period: "monthly", billing_interval: 1, is_active: true, razorpay_plan_id_test: "plan_x", razorpay_plan_id_live: null }]), [
      { code: "m", name: "M", amountPaise: 100, period: "monthly", interval: 1, isActive: true, hasTestPlan: true, hasLivePlan: false },
    ]);
  });

  test("labels and parameters", () => {
    assert.equal(paymentLabel("captured", 100), "Partly refunded");
    assert.equal(monthLabel("2026-11"), "Nov 2026");
    assert.equal(parseMode("test"), "test");
    assert.equal(parseMode("anything"), "live");
    assert.equal(parsePaymentFilter("failed"), "failed");
    assert.equal(parsePaymentFilter("drop"), "all");
    assert.equal(parsePage("3"), 3);
    assert.equal(parsePage("-1"), 1);
    assert.equal(parsePage("99999"), 1);
  });
});

describe("paid through", () => {
  test("a period ending at 00:00 India time covers the day before", () => {
    assert.equal(lastCoveredInstant("2026-12-05T18:30:00Z"), "2026-12-05T18:29:59.999Z");
    assert.equal(lastCoveredInstant(null), null);
    assert.equal(lastCoveredInstant("not a date"), null);
  });
});

describe("plans and refunds in Admin", () => {
  test("a plan carries its description, features and Razorpay ids; anything without a code is dropped", () => {
    const plan = parsePlanDetail({ code: "premium", name: "Premium", description: "All of FITX", features: ["Coach", "", 3, "Programmes"], amount_paise: 19900, billing_period: "monthly", billing_interval: 1, is_active: false, razorpay_plan_id_test: "plan_T1", razorpay_plan_id_live: null, sort_order: 2 });
    assert.ok(plan);
    assert.deepEqual(plan.features, ["Coach", "Programmes"]);
    assert.equal(plan.razorpayPlanIdTest, "plan_T1");
    assert.equal(plan.razorpayPlanIdLive, null);
    assert.equal(plan.sortOrder, 2);
    assert.equal(parsePlanDetail({ name: "No code" }), null);
    assert.equal(parsePlanDetail(null), null);
  });

  test("refunds open the payment in the Razorpay Dashboard, only while something is left to refund", () => {
    assert.equal(razorpayPaymentUrl("pay_Abc123"), "https://dashboard.razorpay.com/app/payments/pay_Abc123");
    assert.equal(razorpayPaymentUrl("pay_../../x"), null);
    assert.equal(canRefund({ status: "captured", amountPaise: 19900, refundedPaise: 0 }), true);
    assert.equal(canRefund({ status: "captured", amountPaise: 19900, refundedPaise: 19900 }), false);
    assert.equal(canRefund({ status: "failed", amountPaise: 19900, refundedPaise: 0 }), false);
  });
});
