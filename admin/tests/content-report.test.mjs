// The Reports data: what fitx_admin_op_report returns is checked before it is shown, an unreadable value
// never turns into 0, and the CSV exports carry only aggregates.
import test from "node:test";
import assert from "node:assert/strict";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const report = await importTypeScriptModule("src/lib/content/report.ts");

const day = (date, values = {}) => ({
  day: date, new_accounts: 0, dau: 0, wau: 0, mau: 0, workouts_completed: 0, workout_members: 0, sets_logged: 0,
  meals_logged: 0, meal_members: 0, water_entries: 0, activities_recorded: 0, ...values,
});

const sample = () => ({
  generated_at: "2026-11-20T10:00:00Z",
  days: 30,
  from: "2026-11-15",
  to: "2026-11-18",
  accounts_total: "12",
  accounts_before: 9,
  daily: [
    day("2026-11-15", { new_accounts: 1, dau: 2, wau: 3, mau: 5, meals_logged: 4 }),
    day("2026-11-16", { new_accounts: 0, dau: 1, wau: 3, mau: 5, workouts_completed: 2 }),
    day("2026-11-17", { new_accounts: 2, dau: 3, wau: 4, mau: 6, meals_logged: 1 }),
    day("2026-11-18", { new_accounts: 0, dau: 2, wau: 4, mau: 8, workouts_completed: 1 }),
  ],
  workouts: {
    completed: 3, abandoned: 1, members: 2, avg_minutes: null,
    top_exercises: [{ exercise_id: "bench_press", name: "Barbell Bench Press", sessions: 2, members: 2 }],
    activities_by_sport: { run: 1 }, programme_enrolments_active: 1, programme_enrolments_started: 0,
  },
  nutrition: {
    meals: 5, members: 2, barcode_meals: 1, by_source: [{ source: "=HYPERLINK(\"x\")", meals: 3 }], by_slot: { Breakfast: 4, Lunch: 1 },
    custom_foods_created: 0, saved_meals_created: 1, routines_created: 0, water_entries: 2,
  },
  subscriptions: { by_status: { active: 1 }, paying_now: 1 },
  monthly: [{ month: "2026-11", new_accounts: 3, subscriptions_started: 1, cancellations: 0, payments_captured: 1, payments_failed: 0, captured_paise: 19900, refunded_paise: 0 }],
});

test("a report reads counts as numbers or numeric strings; average length may be unknown", () => {
  const parsed = report.parseReport(sample());
  assert.ok(parsed);
  assert.equal(parsed.accountsTotal, 12);
  assert.equal(parsed.workouts.avgMinutes, null);
  assert.equal(parsed.daily.length, 4);
  assert.deepEqual(parsed.subscriptions, { byStatus: { active: 1 }, payingNow: 1 });
});

test("anything that is not a count makes the whole report unreadable instead of 0", () => {
  const broken = (change) => {
    const value = sample();
    change(value);
    return report.parseReport(value);
  };
  assert.equal(broken((v) => { v.daily[1].dau = null; }), null);
  assert.equal(broken((v) => { v.daily[1].mau = -1; }), null);
  assert.equal(broken((v) => { v.daily[0].day = "15 Nov"; }), null);
  assert.equal(broken((v) => { v.nutrition.meals = "lots"; }), null);
  assert.equal(broken((v) => { v.monthly[0].captured_paise = 1.5; }), null);
  assert.equal(broken((v) => { delete v.workouts; }), null);
  assert.equal(broken((v) => { v.workouts.avg_minutes = "NaN"; }), null);
  assert.equal(report.parseReport(null), null);
});

test("growth, active users and weeks are worked out from the daily rows", () => {
  const parsed = report.parseReport(sample());
  assert.deepEqual(report.cumulativeAccounts(parsed), [10, 10, 12, 12]);
  assert.equal(report.total(parsed.daily, "new_accounts"), 3);
  assert.equal(report.latest(parsed.daily, "mau"), 8);
  assert.equal(report.latest([], "mau"), null);
  assert.equal(report.stickiness(parsed.daily), 0.25, "a share; the page shows it as 25 %");
  assert.equal(report.stickiness([day("2026-11-18")]), null, "no monthly actives: unknown, not 0 %");
  assert.equal(report.percentChange(9, 12), 33);
  assert.equal(report.percentChange(0, 4), null);
  // 15 Nov 2026 is a Sunday: it belongs to the week from Monday 9 Nov.
  assert.deepEqual(report.weekly(parsed.daily, "workouts_completed"), [{ week: "2026-11-09", value: 0 }, { week: "2026-11-16", value: 3 }]);
  assert.equal(report.parseRange("365"), 365);
  assert.equal(report.parseRange("7"), 90);
});

test("CSV exports hold aggregates, guard against spreadsheet formulas and use rupees", () => {
  const parsed = report.parseReport(sample());
  const daily = report.reportCsv(parsed, "daily").split("\r\n");
  assert.match(daily[0], /^Day \(IST\),Accounts at end of day,New accounts,Daily active/);
  assert.equal(daily[1].split(",")[1], "10");
  const nutrition = report.reportCsv(parsed, "nutrition");
  assert.match(nutrition, /"Meals from source: =HYPERLINK\(""x""\)"/);
  assert.doesNotMatch(nutrition, /\r\n=HYPERLINK/);
  const monthly = report.reportCsv(parsed, "monthly");
  assert.match(monthly, /2026-11,3,1,0,1,0,199\.00,0\.00,199\.00/);
  // A month with a refund and no capture: the net stays a number a spreadsheet can add up.
  const refundOnly = report.parseReport({ ...sample(), monthly: [{ month: "2026-10", new_accounts: 0, subscriptions_started: 0, cancellations: 0, payments_captured: 0, payments_failed: 0, captured_paise: 0, refunded_paise: 49900 }] });
  assert.match(report.reportCsv(refundOnly, "monthly"), /\r\n2026-10,0,0,0,0,0,0\.00,499\.00,-499\.00\r\n/);
  assert.doesNotMatch(report.reportCsv(refundOnly, "monthly"), /'-499/);
  assert.match(report.reportCsv(parsed, "exercises"), /Barbell Bench Press,bench_press,2,2/);
  assert.equal(report.isExportKind("daily"), true);
  assert.equal(report.isExportKind("__proto__"), false);
});
