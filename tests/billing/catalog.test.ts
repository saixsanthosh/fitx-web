// What /pricing, /terms and /refunds are told about Premium sales, read through supabase-js and the test
// PostgREST from the real billing SQL. "Closed" only ever means "not on sale right now"; a failed read
// throws (so Next keeps serving the last good page) except while `next build` prerenders.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import "./support/server-only.mjs";
import { PgRest } from "./support/pg-rest.ts";
import { addPlan, TestDatabase } from "./support/pg.ts";

const SERVICE_KEY = "catalog-service-key";
const liveEnv = (supabaseUrl: string, extra: Record<string, string> = {}) => ({
  RAZORPAY_KEY_ID: "rzp_live_FitxCatalog01",
  RAZORPAY_KEY_SECRET: "catalog-live-secret",
  RAZORPAY_WEBHOOK_SECRET: "catalog-webhook-secret",
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  SUPABASE_SECRET_KEY: SERVICE_KEY,
  ...extra,
});

describe("public plan catalog", { skip: TestDatabase.available() ? false : "PostgreSQL is not installed" }, () => {
  let db: TestDatabase;
  let bare: TestDatabase;
  let rest: PgRest;
  let bareRest: PgRest;
  let failing: Server;
  let failingUrl = "";
  let loadPublicCatalog: typeof import("@/lib/billing/catalog").loadPublicCatalog;

  before(async () => {
    [db, bare] = await Promise.all([TestDatabase.start(), TestDatabase.start({ migrate: false })]);
    rest = await new PgRest(db, SERVICE_KEY).start();
    bareRest = await new PgRest(bare, SERVICE_KEY).start();
    // A database that is up but failing: every read answers HTTP 500.
    failing = createServer((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "XX000", message: "database unavailable", details: null, hint: null }));
    });
    await new Promise<void>((resolve) => failing.listen(0, "127.0.0.1", resolve));
    failingUrl = `http://127.0.0.1:${(failing.address() as AddressInfo).port}`;
    ({ loadPublicCatalog } = await import("@/lib/billing/catalog"));
  });
  after(async () => {
    await rest?.stop();
    await bareRest?.stop();
    await new Promise<void>((resolve) => (failing ? failing.close(() => resolve()) : resolve()));
    await db?.stop();
    await bare?.stop();
  });

  test("closed before live billing is set up", async () => {
    assert.deepEqual(await loadPublicCatalog({}), { open: false, reason: "not_configured" });
    assert.deepEqual(await loadPublicCatalog(liveEnv(rest.url, { RAZORPAY_KEY_ID: "rzp_test_FitxCatalog01" })), { open: false, reason: "not_configured" }, "test mode");
    assert.deepEqual(await loadPublicCatalog(liveEnv(bareRest.url)), { open: false, reason: "not_configured" }, "migration not applied");
  });

  test("not on sale until a plan with a live Razorpay plan is active", async () => {
    await addPlan(db, { code: "premium-test-only", name: "Test only", amount: 19900, period: "monthly", testPlanId: "plan_TestOnly00001" });
    await addPlan(db, { code: "premium-paused", name: "Paused", amount: 19900, period: "monthly", livePlanId: "plan_LivePaused001", active: false });
    assert.deepEqual(await loadPublicCatalog(liveEnv(rest.url)), { open: false, reason: "not_on_sale" });
    await addPlan(db, { code: "premium-monthly", name: "Premium monthly", amount: 19900, period: "monthly", livePlanId: "plan_LiveMonthly01", features: ["Premium programmes"] });
    const catalog = await loadPublicCatalog(liveEnv(rest.url));
    assert.equal(catalog.open, true);
    assert.deepEqual(catalog.open && catalog.plans.map((plan) => [plan.code, plan.amountPaise, plan.features]), [["premium-monthly", 19900, ["Premium programmes"]]]);
  });

  test("a failed read throws so the last good page stays, except while the build prerenders", async () => {
    await assert.rejects(loadPublicCatalog(liveEnv(failingUrl)));
    assert.deepEqual(await loadPublicCatalog(liveEnv(failingUrl, { NEXT_PHASE: "phase-production-build" })), { open: false, reason: "not_on_sale" });
  });
});

describe("billing copy makes no claim about past payments", () => {
  const page = (file: string) => readFileSync(new URL(`../../src/app/${file}`, import.meta.url), "utf8");
  const pages = [
    "(marketing)/pricing/page.tsx",
    "(marketing)/terms/page.tsx",
    "(marketing)/refunds/page.tsx",
    "(dashboard)/subscription/page.tsx",
  ];

  test("a closed catalog never says that nothing was collected", () => {
    for (const file of pages) {
      const text = page(file);
      for (const claim of [/no (FITX )?payment (has been|is) collected/i, /not on sale yet/i, /if paid plans are introduced/i, /everything in FITX today is free/i]) {
        assert.doesNotMatch(text, claim, `${file}: ${claim}`);
      }
    }
  });
});
