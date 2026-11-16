// The billing migration run in a real PostgreSQL with Supabase's roles: privileges, row-level security,
// has_premium(), idempotent event application, ordering rules, refunds and the Admin totals.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addPlan, addUser, AS_ANON, AS_SERVICE, asUser, lit, SqlError, TestDatabase } from "./support/pg.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CARA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEV = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ERIN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FARID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const GITA = "99999999-9999-4999-8999-999999999999";
const HANA = "12121212-1212-4212-8212-121212121212";
const IRIS = "13131313-1313-4313-8313-131313131313";
const JAY = "14141414-1414-4414-8414-141414141414";
const PLAN_ID = "plan_TestMonthly01";

type Event = Record<string, unknown>;

const denied = (code: string) => (error: unknown) => error instanceof SqlError && error.code === code;

describe("billing schema in PostgreSQL", { skip: TestDatabase.available() ? false : "PostgreSQL is not installed" }, () => {
  let db: TestDatabase;
  let planId = "";

  const checkout = (userId: string, subscriptionId: string, mode = "test") =>
    db.value<string>(`select public.billing_record_checkout(${lit(userId)}, ${lit(planId)}, ${lit(mode)}, ${lit(subscriptionId)}, ${lit(PLAN_ID)}, 120)`, AS_SERVICE);
  const apply = (event: Event) => db.value<Record<string, unknown>>(`select public.billing_apply_event(${lit(JSON.stringify(event))}::jsonb)`, AS_SERVICE);
  const premium = (userId: string) => db.value<boolean>(`select public.has_premium(${lit(userId)})`, asUser(userId));
  const status = (subscriptionId: string) => db.value<string>(`select status from public.billing_subscriptions where provider_subscription_id = ${lit(subscriptionId)}`);

  /** subscription.charged for one paid cycle, as the webhook handler builds it. */
  function charged({ id, sub, pay, start, end, createdAt = at(0), statusAfter = "active", mode = "test" }: {
    id: string; sub: string; pay: string; start: string; end: string; createdAt?: string; statusAfter?: string; mode?: string;
  }): Event {
    return {
      event_id: id, source: "webhook", event_type: "subscription.charged", mode, event_created_at: createdAt, payload: { note: "trimmed payload" },
      subscription: { provider_subscription_id: sub, status: statusAfter, current_start: start, current_end: end, charge_at: end, paid_count: 1, total_count: 120, remaining_count: 119 },
      payment: { provider_payment_id: pay, provider_subscription_id: sub, provider_invoice_id: "inv_TestInvoice001", provider_order_id: null, amount_paise: 19900, currency: "INR", status: "captured", method: "upi", amount_refunded_paise: 0, fee_paise: 470, tax_paise: 72, error_code: null, error_description: null, error_reason: null, error_source: null, error_step: null, period_start: start, period_end: end, provider_created_at: createdAt },
    };
  }
  const subscriptionEvent = (id: string, sub: string, state: string, createdAt: string, extra: Event = {}): Event => ({
    event_id: id, source: "webhook", event_type: `subscription.${state}`, mode: "test", event_created_at: createdAt, payload: {},
    subscription: { provider_subscription_id: sub, status: state, ...extra },
  });

  before(async () => {
    db = await TestDatabase.start();
    for (const [id, email] of [[ALICE, "alice@example.test"], [BOB, "bob@example.test"], [CARA, "cara@example.test"], [DEV, "dev@example.test"], [ERIN, "erin@example.test"], [FARID, "farid@example.test"], [GITA, "gita@example.test"], [HANA, "hana@example.test"], [IRIS, "iris@example.test"], [JAY, "jay@example.test"]]) {
      await addUser(db, id, email);
    }
    planId = await addPlan(db, { code: "premium-monthly", name: "Premium monthly", amount: 19900, period: "monthly", testPlanId: PLAN_ID, features: ["Premium home programmes"] });
    await addPlan(db, { code: "retired", name: "Retired plan", amount: 9900, period: "monthly", active: false });
  });
  after(async () => {
    await db?.stop();
  });

  test("nobody writes billing tables directly, not even the server key", async () => {
    await checkout(ALICE, "sub_TestAlice00001");
    await assert.rejects(db.exec(`update public.billing_subscriptions set status = 'active'`, asUser(ALICE)), denied("42501"));
    await assert.rejects(db.exec(`insert into public.billing_payments (mode, provider_payment_id, amount_paise, currency, status) values ('test', 'pay_Forged000001', 1, 'INR', 'captured')`, asUser(ALICE)), denied("42501"));
    await assert.rejects(db.exec(`delete from public.billing_refunds`, asUser(ALICE)), denied("42501"));
    await assert.rejects(db.exec(`update public.billing_subscriptions set paid_until = now() + interval '1 year'`, AS_SERVICE), denied("42501"));
    await assert.rejects(db.exec(`insert into public.billing_provider_events (event_id, source, event_type, mode) values ('x', 'webhook', 'x', 'test')`, AS_SERVICE), denied("42501"));
    await assert.rejects(db.exec(`select count(*) from public.billing_plans`, AS_ANON), denied("42501"));
    await assert.rejects(db.exec(`select public.has_premium(${lit(ALICE)})`, AS_ANON), denied("42501"));
    await assert.rejects(db.exec(`select count(*) from public.billing_provider_events`, asUser(ALICE)), denied("42501"));
    await assert.rejects(db.exec(`select public.billing_apply_event('{}'::jsonb)`, asUser(ALICE)), denied("42501"));
    await assert.rejects(db.exec(`select public.billing_record_checkout(${lit(ALICE)}, ${lit(planId)}, 'test', 'sub_X1', ${lit(PLAN_ID)}, 1)`, asUser(ALICE)), denied("42501"));
    await assert.rejects(db.exec(`select public.billing_admin_overview('live')`, asUser(ALICE)), denied("42501"));
    await assert.rejects(db.exec(`select public.billing_grants_access('active', now())`, AS_SERVICE), denied("42501"));
  });

  test("members read only their own billing rows, and active plans", async () => {
    await checkout(BOB, "sub_TestBob000001");
    assert.deepEqual(await db.rows(`select provider_subscription_id from public.billing_subscriptions`, asUser(BOB)), [{ provider_subscription_id: "sub_TestBob000001" }]);
    assert.deepEqual(await db.rows(`select code from public.billing_plans order by code`, asUser(BOB)), [{ code: "premium-monthly" }]);
    assert.equal((await db.rows(`select id from public.billing_subscriptions`, AS_SERVICE)).length >= 2, true);
  });

  test("Premium starts with a captured payment, never with checkout alone, and others cannot probe it", async () => {
    assert.equal(await premium(ALICE), false);
    const result = await apply(charged({ id: "evt_alice_1", sub: "sub_TestAlice00001", pay: "pay_TestAlice0001", start: at(-1), end: at(29) }));
    assert.equal(result.outcome, "applied");
    assert.equal(result.status_before, "created");
    assert.equal(result.status_after, "active");
    assert.equal(result.payment_created, true);
    assert.equal(await premium(ALICE), true);
    assert.equal(await db.value(`select public.has_premium(${lit(ALICE)})`, asUser(BOB)), false, "a member cannot ask about someone else");
    assert.equal(await db.value(`select public.has_premium(${lit(ALICE)})`, AS_SERVICE), true);
    assert.equal(await db.value(`select public.has_premium(null)`, asUser(ALICE)), false);
  });

  test("Premium never depends on profiles.plan", async () => {
    const source = await db.value<string>(`select pg_get_functiondef('public.has_premium(uuid)'::regprocedure)`);
    assert.equal(/profiles/.test(source), false);
  });

  test("a redelivered event is applied once", async () => {
    const event = charged({ id: "evt_alice_1", sub: "sub_TestAlice00001", pay: "pay_TestAlice0001", start: at(-1), end: at(29) });
    assert.deepEqual(await apply(event), { outcome: "duplicate" });
    assert.equal(await db.value(`select count(*) from public.billing_payments where provider_payment_id = 'pay_TestAlice0001'`), 1);
    assert.equal(await db.value(`select count(*) from public.billing_provider_events where event_id = 'evt_alice_1'`), 1);
  });

  test("an older event never overrides a newer one, and a final status sticks", async () => {
    const late = await apply(subscriptionEvent("evt_alice_old", "sub_TestAlice00001", "authenticated", at(-2)));
    assert.equal(late.outcome, "applied");
    assert.equal(late.detail, "older_than_applied_snapshot");
    assert.equal(await status("sub_TestAlice00001"), "active");

    await checkout(CARA, "sub_TestCara00001");
    await apply(charged({ id: "evt_cara_1", sub: "sub_TestCara00001", pay: "pay_TestCara00001", start: at(-1), end: at(29), createdAt: at(-1) }));
    await apply(subscriptionEvent("evt_cara_cancel", "sub_TestCara00001", "cancelled", at(0), { ended_at: at(0) }));
    const resurrect = await apply(subscriptionEvent("evt_cara_resume", "sub_TestCara00001", "active", at(0.001)));
    assert.equal(resurrect.detail, "subscription_already_final");
    assert.equal(await status("sub_TestCara00001"), "cancelled");
    // A charge reported after the cancellation is still recorded as money received.
    await apply(charged({ id: "evt_cara_late_charge", sub: "sub_TestCara00001", pay: "pay_TestCara00002", start: at(-31), end: at(-1), createdAt: at(-2) }));
    assert.equal(await db.value(`select count(*) from public.billing_payments where subscription_id = (select id from public.billing_subscriptions where provider_subscription_id = 'sub_TestCara00001')`), 2);
    assert.equal(await status("sub_TestCara00001"), "cancelled");
    assert.equal(await premium(CARA), true, "cancelled, but the paid period has not ended");
  });

  test("renewal grace: 3 days while Razorpay retries, none once it halts", async () => {
    await checkout(DEV, "sub_TestDev000001");
    // Paid period ended a day ago; the renewal failed and is being retried.
    await apply(charged({ id: "evt_dev_1", sub: "sub_TestDev000001", pay: "pay_TestDev000001", start: at(-31), end: at(-1), createdAt: at(-31) }));
    await apply(subscriptionEvent("evt_dev_pending", "sub_TestDev000001", "pending", at(-0.9), { current_start: at(-1), current_end: at(29) }));
    assert.equal(await status("sub_TestDev000001"), "pending");
    assert.equal(await premium(DEV), true, "within 3 days of the paid period");
    // A failed renewal payment, linked by the invoice's subscription id, keeps its reason.
    await apply({
      event_id: "evt_dev_failed", source: "webhook", event_type: "payment.failed", mode: "test", event_created_at: at(-0.9), payload: {},
      payment: { provider_payment_id: "pay_TestDevFail01", provider_subscription_id: "sub_TestDev000001", provider_invoice_id: "inv_TestDevInv002", provider_order_id: null, amount_paise: 19900, currency: "INR", status: "failed", method: "card", amount_refunded_paise: 0, fee_paise: null, tax_paise: null, error_code: "BAD_REQUEST_ERROR", error_description: "Payment declined by the bank", error_reason: "payment_declined", error_source: "bank", error_step: "payment_authorization", period_start: at(-1), period_end: at(29), provider_created_at: at(-0.9) },
    });
    assert.deepEqual(await db.rows(`select status, error_description from public.billing_payments where provider_payment_id = 'pay_TestDevFail01'`), [{ status: "failed", error_description: "Payment declined by the bank" }]);
    assert.equal(await premium(DEV), true, "a failed payment does not extend or cut access");

    await apply(subscriptionEvent("evt_dev_halted", "sub_TestDev000001", "halted", at(-0.5)));
    assert.equal(await premium(DEV), false, "halted: access ends at the paid period");

    await checkout(ERIN, "sub_TestErin00001");
    await apply(charged({ id: "evt_erin_1", sub: "sub_TestErin00001", pay: "pay_TestErin00001", start: at(-35), end: at(-5), createdAt: at(-35) }));
    await apply(subscriptionEvent("evt_erin_pending", "sub_TestErin00001", "pending", at(-4)));
    assert.equal(await premium(ERIN), false, "more than 3 days after the paid period");
  });

  test("a full refund ends Premium for that period; a partial one does not", async () => {
    await checkout(FARID, "sub_TestFarid0001");
    await apply(charged({ id: "evt_farid_1", sub: "sub_TestFarid0001", pay: "pay_TestFarid0001", start: at(-1), end: at(29) }));
    const refund = (id: string, refundId: string, amount: number, paymentStatus: string, refunded: number, state = "processed"): Event => ({
      event_id: id, source: "webhook", event_type: `refund.${state}`, mode: "test", event_created_at: at(0), payload: {},
      payment: { provider_payment_id: "pay_TestFarid0001", provider_invoice_id: null, provider_order_id: null, amount_paise: 19900, currency: "INR", status: paymentStatus, method: "upi", amount_refunded_paise: refunded, fee_paise: null, tax_paise: null, error_code: null, error_description: null, error_reason: null, error_source: null, error_step: null, provider_created_at: null },
      refund: { provider_refund_id: refundId, provider_payment_id: "pay_TestFarid0001", amount_paise: amount, currency: "INR", status: state, speed_requested: "normal", speed_processed: "normal", provider_created_at: at(0) },
    });
    await apply(refund("evt_farid_partial", "rfnd_TestFarid001", 5000, "captured", 5000));
    assert.equal(await premium(FARID), true);
    assert.deepEqual(await db.rows(`select status, amount_refunded_paise, refund_status from public.billing_payments where provider_payment_id = 'pay_TestFarid0001'`), [{ status: "captured", amount_refunded_paise: 5000, refund_status: "partial" }]);
    await apply(refund("evt_farid_rest", "rfnd_TestFarid002", 14900, "refunded", 19900));
    assert.equal(await premium(FARID), false);
    // A processed refund never goes back to pending.
    await apply(refund("evt_farid_rest_late", "rfnd_TestFarid002", 14900, "refunded", 19900, "pending"));
    assert.deepEqual(await db.rows(`select status from public.billing_refunds where provider_refund_id = 'rfnd_TestFarid002'`), [{ status: "processed" }]);
    assert.deepEqual(await db.rows(`select amount_paise from public.billing_refunds where user_id = ${lit(FARID)} order by amount_paise`, asUser(FARID)), [{ amount_paise: 5000 }, { amount_paise: 14900 }]);
  });

  test("events about records FITX does not know are recorded and ignored", async () => {
    const unknown = await apply(subscriptionEvent("evt_unknown_sub", "sub_NotFitx000001", "active", at(0)));
    assert.deepEqual(unknown, { outcome: "ignored", detail: "unknown_subscription" });
    const orphan = await apply({
      event_id: "evt_unknown_pay", source: "webhook", event_type: "payment.captured", mode: "test", event_created_at: at(0), payload: {},
      payment: { provider_payment_id: "pay_NotFitx000001", provider_invoice_id: null, provider_order_id: null, amount_paise: 100, currency: "INR", status: "captured", method: "card", amount_refunded_paise: 0, fee_paise: null, tax_paise: null, error_code: null, error_description: null, error_reason: null, error_source: null, error_step: null, provider_created_at: null },
    });
    assert.equal(orphan.outcome, "ignored");
    assert.equal(orphan.detail, "unknown_payment");
    assert.deepEqual(await db.rows(`select outcome, outcome_detail from public.billing_provider_events where event_id in ('evt_unknown_sub', 'evt_unknown_pay') order by event_id`), [
      { outcome: "ignored", outcome_detail: "unknown_payment" },
      { outcome: "ignored", outcome_detail: "unknown_subscription" },
    ]);
  });

  test("a record from the other Razorpay mode is refused and nothing is written", async () => {
    await assert.rejects(apply(charged({ id: "evt_mode", sub: "sub_TestAlice00001", pay: "pay_TestAlice0099", start: at(0), end: at(30), mode: "live" })), (error) => error instanceof SqlError && error.message.includes("billing_mode_mismatch"));
    assert.equal(await db.value(`select count(*) from public.billing_provider_events where event_id = 'evt_mode'`), 0);
    assert.equal(await db.value(`select count(*) from public.billing_payments where provider_payment_id = 'pay_TestAlice0099'`), 0);
  });

  test("checkout: one open checkout per account, none while Razorpay is billing", async () => {
    const first = await checkout(GITA, "sub_TestGita00001");
    const second = await checkout(GITA, "sub_TestGita00002");
    assert.notEqual(first, second);
    assert.deepEqual(await db.rows(`select provider_subscription_id, abandoned_at is not null as abandoned from public.billing_subscriptions where user_id = ${lit(GITA)} order by created_at, provider_subscription_id`), [
      { provider_subscription_id: "sub_TestGita00001", abandoned: true },
      { provider_subscription_id: "sub_TestGita00002", abandoned: false },
    ]);
    await assert.rejects(checkout(ALICE, "sub_TestAlice00009"), (error) => error instanceof SqlError && error.message.includes("billing_already_subscribed"));
    // A live-mode checkout is separate from test-mode records.
    assert.ok(await checkout(ALICE, "sub_LiveAlice00001", "live"));
    await assert.rejects(
      db.exec(`insert into public.billing_subscriptions (user_id, plan_id, mode, provider_subscription_id, provider_plan_id) values (${lit(GITA)}, ${lit(planId)}, 'test', 'sub_TestGita00003', ${lit(PLAN_ID)})`),
      denied("23505"),
    );
  });

  test("an API read sets cancel_requested_at; reconciliation stamps last_reconciled_at", async () => {
    await apply({ event_id: "api:cancel:alice", source: "api", event_type: "fitx.subscription_cancel", mode: "test", event_created_at: at(0.01), payload: {}, subscription: { provider_subscription_id: "sub_TestAlice00001", status: "cancelled", ended_at: at(0.01), cancel_requested: true } });
    assert.deepEqual(await db.rows(`select status, cancel_requested_at is not null as requested from public.billing_subscriptions where provider_subscription_id = 'sub_TestAlice00001'`), [{ status: "cancelled", requested: true }]);
    assert.equal(await premium(ALICE), true, "keeps Premium until the paid period ends");
    // Only the server's own cancel (source api) may set the flag.
    await apply({ event_id: "evt_forged_flag", source: "webhook", event_type: "subscription.cancelled", mode: "test", event_created_at: at(0.02), payload: {}, subscription: { provider_subscription_id: "sub_TestBob000001", status: "cancelled", cancel_requested: true } });
    assert.equal(await db.value(`select cancel_requested_at is null from public.billing_subscriptions where provider_subscription_id = 'sub_TestBob000001'`), true);

    const candidates = await db.rows<{ provider_subscription_id: string }>(`select * from public.billing_reconcile_candidates('test', 50)`, AS_SERVICE);
    assert.ok(candidates.some((row) => row.provider_subscription_id === "sub_TestDev000001"));
    await apply({ event_id: "reconcile:run1:sub_TestDev000001", source: "reconcile", event_type: "fitx.reconcile.subscription", mode: "test", event_created_at: at(0), payload: {}, subscription: { provider_subscription_id: "sub_TestDev000001", status: "halted" } });
    assert.equal(await db.value(`select last_reconciled_at is not null from public.billing_subscriptions where provider_subscription_id = 'sub_TestDev000001'`), true);
    const runId = await db.value(`select public.billing_record_reconciliation('{"mode":"test","started_at":"2026-11-17T00:00:00Z","subscriptions_checked":4,"corrections":1,"errors":0,"detail":{"candidates":4}}'::jsonb)`, AS_SERVICE);
    assert.ok(Number(runId) > 0);
  });

  test("Admin totals: captured minus refunded, per mode, from verified rows only", async () => {
    const overview = await db.value<Record<string, unknown>>(`select public.billing_admin_overview('test')`, AS_SERVICE);
    // Captured: Alice 19900, Cara 2 x 19900, Dev 19900, Erin 19900, Farid 19900 = 6 x 19900. Refunded: Farid 19900.
    assert.equal(overview.captured_paise_total, 6 * 19900);
    assert.equal(overview.refunded_paise_total, 19900);
    assert.equal(overview.payments_failed_30d, 1);
    assert.equal(overview.fees_paise_total, 6 * 470);
    assert.equal(overview.subscribers_with_access, 2, "Alice and Cara still have their paid period");
    assert.equal((overview.last_reconciliation as Record<string, unknown>).corrections, 1);
    assert.ok(overview.last_webhook_at);
    const live = await db.value<Record<string, unknown>>(`select public.billing_admin_overview('live')`, AS_SERVICE);
    assert.equal(live.captured_paise_total, 0);
    assert.deepEqual(live.subscriptions_by_status, { created: 1 });

    const subscribers = await db.rows<{ email: string; status: string; has_access: boolean; total_rows: number }>(`select * from public.billing_admin_subscriptions('test', 50, 0)`, AS_SERVICE);
    assert.ok(subscribers.some((row) => row.email === "alice@example.test" && row.status === "cancelled" && row.has_access));
    assert.equal(subscribers.filter((row) => row.email === "gita@example.test").length, 1, "abandoned checkouts are hidden");
    const failed = await db.rows<{ email: string; error_description: string }>(`select * from public.billing_admin_payments('test', 'failed', 50, 0)`, AS_SERVICE);
    assert.deepEqual(failed.map((row) => [row.email, row.error_description]), [["dev@example.test", "Payment declined by the bank"]]);
    const refunds = await db.rows<{ provider_refund_id: string }>(`select * from public.billing_admin_refunds('test', 50, 0)`, AS_SERVICE);
    assert.equal(refunds.length, 2);
  });

  test("an account records at most 10 checkouts per mode in 24 hours, even from a parallel burst", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => checkout(HANA, `sub_TestHanaBurst${String(i).padStart(2, "0")}`)),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 10);
    const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(refused.length, 2);
    assert.ok(refused.every((result) => result.reason instanceof SqlError && result.reason.message.includes("billing_checkout_limit")));
    assert.equal(await db.value(`select count(*) from public.billing_subscriptions where user_id = ${lit(HANA)} and status = 'created' and abandoned_at is null`), 1);
    assert.ok(await checkout(HANA, "sub_LiveHana000001", "live"), "test and live are counted apart");
    // Checkouts older than a day no longer count.
    await db.exec(`update public.billing_subscriptions set created_at = now() - interval '25 hours' where user_id = ${lit(HANA)} and mode = 'test'`);
    assert.ok(await checkout(HANA, "sub_TestHanaLater01"));
  });

  test("reconciliation checks what Razorpay still bills first, and ended subscriptions age out", async () => {
    await checkout(IRIS, "sub_TestIris00001");
    await apply(charged({ id: "evt_iris_1", sub: "sub_TestIris00001", pay: "pay_TestIris00001", start: at(-71), end: at(-41), createdAt: at(-71) }));
    await apply(subscriptionEvent("evt_iris_cancel", "sub_TestIris00001", "cancelled", at(-41), { ended_at: at(-41) }));
    const touched = () => db.value<string>(`select updated_at::text from public.billing_subscriptions where provider_subscription_id = 'sub_TestIris00001'`);
    const before = await touched();
    // The nightly read of an ended subscription changes nothing, so it does not count as a change.
    const read = await apply({ event_id: "reconcile:run2:sub_TestIris00001", source: "reconcile", event_type: "fitx.reconcile.subscription", mode: "test", event_created_at: at(0), payload: {}, subscription: { provider_subscription_id: "sub_TestIris00001", status: "cancelled", ended_at: at(-41) } });
    assert.equal(read.detail, "subscription_already_final");
    assert.equal(await touched(), before);

    const candidates = await db.rows<{ provider_subscription_id: string; bucket: number }>(
      `select c.provider_subscription_id,
              case when s.status = 'created' and s.abandoned_at is not null then 2
                   when s.status in ('cancelled', 'completed', 'expired') then 1 else 0 end as bucket
       from public.billing_reconcile_candidates('test', 500) with ordinality as c(id, provider_subscription_id, status, n)
       join public.billing_subscriptions s on s.id = c.id
       order by c.n`,
      AS_SERVICE,
    );
    assert.equal(candidates.some((row) => row.provider_subscription_id === "sub_TestIris00001"), false, "ended more than 40 days ago");
    assert.ok(candidates.some((row) => row.provider_subscription_id === "sub_TestCara00001"), "ended recently: refunds are still plausible");
    const buckets = candidates.map((row) => row.bucket);
    assert.deepEqual([...new Set(buckets)], [0, 1, 2], "still billed and open checkouts first, then ended ones, then replaced checkouts");
    assert.deepEqual(buckets, [...buckets].sort((a, b) => a - b));
  });

  test("within one second, a late 'authenticated' never undoes 'active'", async () => {
    await checkout(JAY, "sub_TestJay000001");
    // Razorpay's webhook times are whole seconds; these three events share one.
    const second = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    await apply(charged({ id: "evt_jay_charged", sub: "sub_TestJay000001", pay: "pay_TestJay000001", start: at(-1), end: at(29), createdAt: second }));
    const late = await apply(subscriptionEvent("evt_jay_authenticated", "sub_TestJay000001", "authenticated", second));
    assert.equal(late.detail, "older_than_applied_snapshot");
    assert.equal(await status("sub_TestJay000001"), "active");
    // Later steps in the same second still apply in arrival order.
    const pending = await apply(subscriptionEvent("evt_jay_pending", "sub_TestJay000001", "pending", second));
    assert.equal(pending.detail, null);
    assert.equal(await status("sub_TestJay000001"), "pending");
  });
});
