import { logBillingUnavailable, readBillingConfig } from "@/lib/billing/config";
import { createBillingDeps } from "@/lib/billing/deps";
import { bearerMatches, noStore } from "@/lib/billing/http";
import { reconcileSubscriptions } from "@/lib/billing/reconcile";

export const maxDuration = 60;

/**
 * Nightly comparison with Razorpay, called by Vercel Cron with "Authorization: Bearer $CRON_SECRET".
 * Schedule it in vercel.json: { "crons": [{ "path": "/api/billing/reconcile", "schedule": "30 20 * * *" }] }
 * (20:30 UTC is 02:00 IST). It can also be run by hand with the same header.
 */
export async function GET(request: Request) {
  const config = readBillingConfig();
  if (!config.ok) {
    logBillingUnavailable(config.reason);
    return noStore({ error: "billing_not_configured" }, 503);
  }
  if (!config.config.cronSecret) return noStore({ error: "cron_secret_missing" }, 503);
  if (!bearerMatches(request.headers.get("authorization"), config.config.cronSecret)) return noStore({ error: "unauthorized" }, 401);

  try {
    const summary = await reconcileSubscriptions(createBillingDeps(config.config), { limit: 150, budgetMs: 45_000 });
    return noStore(summary);
  } catch (error) {
    console.error(`[fitx-billing] reconcile run failed: ${error instanceof Error ? error.message : "error"}`);
    return noStore({ error: "reconcile_failed" }, 500);
  }
}
