import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
// The route stops Razorpay billing first; the billing modules import "server-only", which Next resolves itself.
import "../billing/support/server-only.mjs";
import { FakeRazorpay } from "../billing/support/fake-razorpay.ts";
import { subscriptionEntity } from "../billing/support/razorpay-payloads.ts";
import { FakeAccountServer, SESSION_COOKIE, ssrCookieValue } from "../support/fake-account-server.ts";

const fake = await new FakeAccountServer().start();
process.env.NEXT_PUBLIC_SUPABASE_URL = fake.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

const { NextRequest } = await import("next/server");
const route = await import("@/app/api/account/route");
const { isAllowedStatusRequest, isAuthOutage, isRecentSignIn, sessionSignedInAt, RECENT_SIGN_IN_MINUTES } = await import("@/lib/account/deletion");

const ME = { id: "11111111-1111-4111-8111-111111111111", email: "me@example.test" };
const OTHER = { id: "22222222-2222-4222-8222-222222222222", email: "other@example.test" };

function request(method: "GET" | "DELETE", { signedInSecondsAgo, body, site = "same-origin", user = ME.id }: { signedInSecondsAgo?: number; body?: unknown; site?: string | null; user?: string } = {}) {
  // site: null sends no fetch metadata at all, like Safari before 16.4 on a same-origin GET.
  const headers: Record<string, string> = { host: "fitnessx.vercel.app", "x-forwarded-proto": "https", "content-type": "application/json", ...(site ? { "sec-fetch-site": site } : {}) };
  if (signedInSecondsAgo !== undefined) headers.cookie = `${SESSION_COOKIE}=${ssrCookieValue(fake.session(user, signedInSecondsAgo))}; fitx_auth=1; fitx_onboarded=${user}`;
  return new NextRequest(new URL("/api/account", "https://fitnessx.vercel.app"), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

before(() => {
  fake.addUser(ME.id, ME.email);
  fake.addUser(OTHER.id, OTHER.email);
});
beforeEach(() => {
  fake.reset();
  if (!fake.users.has(ME.id)) fake.addUser(ME.id, ME.email);
  process.env.SUPABASE_SECRET_KEY = fake.secretKey;
});
after(() => fake.stop());

describe("deletion status", () => {
  test("is unavailable without the server secret, and says so", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    const response = await route.GET(request("GET", { signedInSecondsAgo: 60 }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const { deletion } = await response.json();
    assert.equal(deletion.available, false);
    assert.equal(deletion.recentSignIn, true);
    assert.equal(deletion.windowMinutes, RECENT_SIGN_IN_MINUTES);
  });

  test("names the session's own account, so the dialog can show which one it deletes", async () => {
    const { deletion } = await (await route.GET(request("GET", { signedInSecondsAgo: 60 }))).json();
    assert.equal(deletion.userId, ME.id);
    assert.equal(deletion.email, ME.email);
    const other = (await (await route.GET(request("GET", { signedInSecondsAgo: 60, user: OTHER.id }))).json()).deletion;
    assert.equal(other.email, OTHER.email);
  });

  test("answers browsers that send no fetch metadata on a same-origin GET", async () => {
    const response = await route.GET(request("GET", { signedInSecondsAgo: 60, site: null }));
    assert.equal(response.status, 200);
  });

  test("reports whether this session's sign-in is recent", async () => {
    assert.equal((await (await route.GET(request("GET", { signedInSecondsAgo: 60 }))).json()).deletion.recentSignIn, true);
    assert.equal((await (await route.GET(request("GET", { signedInSecondsAgo: 3 * 3600 }))).json()).deletion.recentSignIn, false);
  });

  test("refuses signed-out and cross-site requests", async () => {
    assert.equal((await route.GET(request("GET"))).status, 401);
    assert.equal((await route.GET(request("GET", { signedInSecondsAgo: 60, site: "cross-site" }))).status, 403);
  });
});

describe("deleting the account", () => {
  test("removes every private file, then the login, and ends the session on this device", async () => {
    fake.files.set(`fitx-user-media/${ME.id}`, [{ name: "avatar-1.jpg", id: "f1", metadata: { size: 10 } }, { name: "progress", id: null }]);
    fake.files.set(`fitx-user-media/${ME.id}/progress`, [{ name: "front.webp", id: "f2" }]);
    const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 120, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true, removedFiles: 2 });
    assert.deepEqual(fake.removed.sort(), [`${ME.id}/avatar-1.jpg`, `${ME.id}/progress/front.webp`]);
    assert.deepEqual(fake.deletedUsers, [ME.id]);
    // Files go first, so a storage failure can never leave files behind a deleted login.
    const order = fake.calls.map((call) => `${call.method} ${call.path}`);
    assert.ok(order.indexOf("DELETE /storage/v1/object/fitx-user-media") < order.indexOf(`DELETE /auth/v1/admin/users/${ME.id}`));
    // The secret key is only ever used for the admin calls.
    assert.ok(fake.calls.filter((call) => call.path === "/auth/v1/user").every((call) => call.auth !== fake.secretKey));
    const cookies = response.headers.getSetCookie();
    for (const name of [SESSION_COOKIE, "fitx_auth", "fitx_onboarded", "fitx_intro_checked"]) {
      assert.ok(cookies.some((line) => line.startsWith(`${name}=;`) && /max-age=0/i.test(line)), `${name} cleared`);
    }
    assert.equal(fake.users.has(OTHER.id), true);
  });

  test("deletes nothing when the signed-in account isn't the one the screen confirmed", async () => {
    fake.files.set(`fitx-user-media/${ME.id}`, [{ name: "avatar-1.jpg", id: "f1" }]);
    for (const body of [{ confirm: "DELETE", expectedUserId: OTHER.id }, { confirm: "DELETE" }]) {
      const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body }));
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error, "account_changed");
    }
    assert.deepEqual(fake.deletedUsers, []);
    assert.deepEqual(fake.removed, []);
    assert.equal(fake.users.has(ME.id), true);
  });

  test("deletes an account that never finished setup (the onboarding delete link)", async () => {
    // The route doesn't depend on onboarding; a fresh sign-up already meets the recent-sign-in rule.
    const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 5, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(response.status, 200);
    assert.deepEqual(fake.deletedUsers, [ME.id]);
  });

  test("keeps an account with active FITX Admin access, before anything is removed", async () => {
    // Its membership would cascade away with the login, past Admin's last-super-admin rule.
    fake.files.set(`fitx-user-media/${ME.id}`, [{ name: "avatar-1.jpg", id: "f1" }]);
    fake.adminMembers.set(ME.id, { is_active: true });
    const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "admin_access");
    assert.deepEqual(fake.removed, []);
    assert.deepEqual(fake.deletedUsers, []);
    assert.equal(fake.users.has(ME.id), true);
    // The check uses the server key, like Admin's own membership reads.
    assert.ok(fake.calls.some((call) => call.path === "/rest/v1/fitx_admin_members" && call.auth === fake.secretKey));
  });

  test("keeps the account when its Admin access can't be checked", async () => {
    fake.adminMembersState = "error";
    const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "admin_check_failed");
    assert.deepEqual(fake.deletedUsers, []);
  });

  test("deletes an account whose Admin access is switched off, or before the Admin tables exist", async () => {
    fake.adminMembers.set(ME.id, { is_active: false });
    const inactive = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(inactive.status, 200);
    assert.deepEqual(fake.deletedUsers, [ME.id]);

    fake.reset();
    fake.addUser(ME.id, ME.email);
    fake.adminMembersState = "missing";
    const before = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(before.status, 200);
    assert.deepEqual(fake.deletedUsers, [ME.id]);
  });

  test("asks for a fresh sign-in when the last one is too old", async () => {
    const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: (RECENT_SIGN_IN_MINUTES + 1) * 60, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "reauth_required");
    assert.deepEqual(fake.deletedUsers, []);
    assert.deepEqual(fake.removed, []);
  });

  test("needs the typed confirmation", async () => {
    for (const body of [{}, { confirm: "delete" }, { confirm: true }]) {
      const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body }));
      assert.equal(response.status, 400);
    }
    const noBody = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30 }));
    assert.equal(noBody.status, 400);
    assert.deepEqual(fake.deletedUsers, []);
  });

  test("explains that deletion isn't set up when the server secret is missing", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "not_configured");
  });

  test("keeps the account when its files can't be removed, or when Supabase refuses", async () => {
    fake.files.set(`fitx-user-media/${ME.id}`, [{ name: "avatar-1.jpg", id: "f1" }]);
    fake.failRemove = true;
    const storageDown = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(storageDown.status, 502);
    assert.equal((await storageDown.json()).error, "files_not_deleted");
    assert.deepEqual(fake.deletedUsers, []);

    fake.failRemove = false;
    fake.failDelete = true;
    const refused = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(refused.status, 502);
    assert.equal((await refused.json()).error, "delete_failed");
    assert.ok(!refused.headers.getSetCookie().some((line) => line.startsWith(`${SESSION_COOKIE}=;`)));
  });

  test("refuses signed-out and cross-site requests", async () => {
    assert.equal((await route.DELETE(request("DELETE", { body: { confirm: "DELETE", expectedUserId: ME.id } }))).status, 401);
    assert.equal((await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id }, site: "cross-site" }))).status, 403);
    assert.deepEqual(fake.deletedUsers, []);
  });
});

describe("deleting an account with billing switched on", () => {
  const KEY_ID = "rzp_test_FitxAccount01";
  const KEY_SECRET = "test-key-secret-value";
  const SUBSCRIPTION = "sub_TestMember0001";
  let razorpay: FakeRazorpay;

  before(async () => {
    razorpay = await new FakeRazorpay(KEY_ID, KEY_SECRET).start();
  });
  beforeEach(() => {
    Object.assign(process.env, { RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: "whsec-test-value", RAZORPAY_API_BASE: razorpay.url });
    razorpay.calls = [];
    razorpay.failNext = null;
    razorpay.subscriptions.set(SUBSCRIPTION, subscriptionEntity({ id: SUBSCRIPTION, plan_id: "plan_TestMonthly01", status: "active" }));
    fake.subscriptions = [{
      id: "33333333-3333-4333-8333-333333333333", user_id: ME.id, plan_id: "44444444-4444-4444-8444-444444444444", mode: "test",
      provider_subscription_id: SUBSCRIPTION, provider_plan_id: "plan_TestMonthly01", status: "active",
      paid_until: "2026-12-17T00:00:00Z", charge_at: null, cancel_requested_at: null, abandoned_at: null, created_at: "2026-11-17T00:00:00Z",
    }];
    fake.files.set(`fitx-user-media/${ME.id}`, [{ name: "avatar-1.jpg", id: "f1" }]);
  });
  after(async () => {
    for (const name of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_API_BASE"]) delete process.env[name];
    await razorpay.stop();
  });

  test("stops the Razorpay subscription before anything is deleted", async () => {
    const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(response.status, 200);
    assert.equal(razorpay.callsTo("POST", new RegExp(`^/v1/subscriptions/${SUBSCRIPTION}/cancel$`)).length, 1);
    assert.equal(fake.billingEvents.length, 1, "the cancellation is recorded in the billing ledger");
    const order = fake.calls.map((call) => `${call.method} ${call.path}`);
    assert.ok(order.indexOf("POST /rest/v1/rpc/billing_apply_event") < order.indexOf("DELETE /storage/v1/object/fitx-user-media"));
    assert.deepEqual(fake.deletedUsers, [ME.id]);
  });

  test("keeps the account and its files when Razorpay can't stop the renewals", async () => {
    razorpay.failNext = { path: /\/cancel$/, status: 503 };
    const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "billing_not_stopped");
    assert.deepEqual(fake.removed, []);
    assert.deepEqual(fake.deletedUsers, []);
  });

  test("an account with active FITX Admin access keeps its subscription too", async () => {
    fake.adminMembers.set(ME.id, { is_active: true });
    const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(response.status, 409);
    assert.equal(razorpay.calls.length, 0, "Razorpay is not asked to cancel anything");
    assert.equal(fake.billingEvents.length, 0);
  });

  test("an account without a live subscription is deleted without calling Razorpay", async () => {
    fake.subscriptions = [];
    const response = await route.DELETE(request("DELETE", { signedInSecondsAgo: 30, body: { confirm: "DELETE", expectedUserId: ME.id } }));
    assert.equal(response.status, 200);
    assert.equal(razorpay.calls.length, 0);
    assert.deepEqual(fake.deletedUsers, [ME.id]);
  });
});

describe("request and outage rules", () => {
  test("an Auth network failure or 5xx is an outage, never 'signed out'", () => {
    assert.equal(isAuthOutage({ name: "AuthRetryableFetchError", status: 0 }), true);
    assert.equal(isAuthOutage({ name: "AuthApiError", status: 503 }), true);
    assert.equal(isAuthOutage({ name: "AuthApiError", status: 403 }), false);
    assert.equal(isAuthOutage(null), false);
  });

  test("the status GET refuses cross-site requests but allows ones without fetch metadata", () => {
    const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
    const origin = "https://fitnessx.vercel.app";
    assert.equal(isAllowedStatusRequest(headers({ "sec-fetch-site": "same-origin" }), origin), true);
    assert.equal(isAllowedStatusRequest(headers({ "sec-fetch-site": "cross-site" }), origin), false);
    assert.equal(isAllowedStatusRequest(headers({ "sec-fetch-site": "same-site" }), origin), false);
    assert.equal(isAllowedStatusRequest(headers({}), origin), true);
    assert.equal(isAllowedStatusRequest(headers({ origin }), origin), true);
    assert.equal(isAllowedStatusRequest(headers({ origin: "https://evil.example" }), origin), false);
  });
});

describe("recent sign-in rule", () => {
  test("uses the newest amr timestamp, then last_sign_in_at", () => {
    assert.equal(sessionSignedInAt({ amr: [{ method: "password", timestamp: 100 }, { method: "totp", timestamp: 300 }] }), 300);
    assert.equal(sessionSignedInAt({ amr: ["password"] }, "2026-11-16T10:00:00Z"), Date.parse("2026-11-16T10:00:00Z") / 1000);
    assert.equal(sessionSignedInAt(null, null), null);
  });

  test("allows the window and a little clock skew, nothing older", () => {
    const now = Date.parse("2026-11-16T10:00:00Z");
    const at = (minutesAgo: number) => now / 1000 - minutesAgo * 60;
    assert.equal(isRecentSignIn(at(1), now), true);
    assert.equal(isRecentSignIn(at(RECENT_SIGN_IN_MINUTES), now), true);
    assert.equal(isRecentSignIn(at(RECENT_SIGN_IN_MINUTES + 1), now), false);
    assert.equal(isRecentSignIn(at(-1), now), true);
    assert.equal(isRecentSignIn(at(-10), now), false);
    assert.equal(isRecentSignIn(null, now), false);
  });
});
