// Flow 10: with no Razorpay keys the subscription page is closed and honest: no plan to buy, no checkout, the
// billing APIs refuse, and nothing is sent to Razorpay.
import { signInUi, textOf } from "./common.mjs";

export const flow = {
  id: "10-subscription",
  title: "Subscription page without Razorpay keys",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Farah Khan", tag: "billing" });
    await signInUi(t, account);

    await t.step("the page says subscriptions open soon and offers no checkout", async () => {
      await t.goto("/subscription", { label: "subscription" });
      const main = await textOf(page.locator("main"));
      t.note("subscription page", main.slice(0, 900));
      t.expect(/Subscriptions open soon/.test(main), "the closed state should be stated");
      t.expect(/A FITX account is free/.test(main), "the page should say the account is free");
      const buy = page.getByRole("button", { name: /subscribe|buy|upgrade|pay|checkout|start premium/i });
      t.expect((await buy.count()) === 0, "no subscribe or checkout button should be offered");
      await t.checkpoint("subscription closed");
    });

    await t.step("pricing is reachable and honest", async () => {
      await page.getByRole("link", { name: "See pricing" }).click();
      await page.waitForURL("**/pricing");
      await t.settle();
      // A signed-in member already has the free account: its card offers the dashboard, never "Create account" (bug 72).
      const free = page.locator("section[aria-labelledby=plan-free]");
      t.expect(await free.getByRole("link", { name: "Open dashboard" }).isVisible(), "signed in, the FITX account card offers Open dashboard");
      t.expect((await free.getByRole("link", { name: "Create account" }).count()) === 0, "and no Create account");
      await t.checkpoint("pricing");
    });

    await t.step("the billing APIs refuse without keys", async () => {
      await t.goto("/subscription", { label: "billing APIs" });
      const answers = await page.evaluate(async () => {
        const call = async (url, init) => {
          const response = await fetch(url, { credentials: "same-origin", ...init });
          let body = null;
          try { body = await response.json(); } catch { body = null; }
          return { url, status: response.status, body };
        };
        return [
          await call("/api/billing/status"),
          await call("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: "monthly" }) }),
          await call("/api/billing/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
        ];
      });
      t.note("billing API answers", answers);
      const [, checkout] = answers;
      t.expect(checkout.status >= 400, `checkout must not open without Razorpay keys (got ${checkout.status})`, checkout);
      const rows = await standin.one(`select (select count(*) from public.billing_subscriptions where user_id = '${account.id}')::int subs, (select count(*) from public.billing_payments where user_id = '${account.id}')::int payments`);
      t.expect(rows.subs === "0" && rows.payments === "0", "no billing rows should be written", rows);
      const razorpay = t.blocked.filter((entry) => /razorpay/i.test(entry.url));
      t.expect(!razorpay.length, "the browser should not contact Razorpay", razorpay);
    });
  },
};
