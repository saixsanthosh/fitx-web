import "server-only";
import { logBillingUnavailable, readBillingConfig } from "./config";
import { BillingStoreError, createBillingDb, listSellablePlans, toPlanView } from "./db";
import type { PlanView } from "./types";

/**
 * open: false only says that no plan is on sale right now. It says nothing about the past: members may
 * still be paying for Premium, so pages must not word it as "nothing was ever charged".
 *  - not_configured: live Razorpay billing is not set up (keys missing, test mode, or the billing
 *    migration not applied), as before launch;
 *  - not_on_sale: billing is set up but no plan is active.
 */
export type PublicCatalog = { open: true; plans: PlanView[] } | { open: false; reason: "not_configured" | "not_on_sale" };

/** Set by `next build` while it prerenders pages (next/constants PHASE_PRODUCTION_BUILD). */
const BUILD_PHASE = "phase-production-build";

/**
 * Plans for the public pricing page, read on the server with the secret key (anon has no access to
 * billing tables). Subscriptions are shown as open only in live mode with at least one active plan:
 * test mode is for the owner's testers, not the public.
 *
 * A failed read throws, except while the build prerenders (then the page starts out closed and is
 * regenerated within minutes): when an ISR regeneration throws, Next keeps serving the last good page
 * and retries on the next request, instead of caching a "closed" page because of one slow query.
 */
export async function loadPublicCatalog(env: Readonly<Record<string, string | undefined>> = process.env): Promise<PublicCatalog> {
  const config = readBillingConfig(env);
  if (!config.ok) {
    logBillingUnavailable(config.reason);
    return { open: false, reason: "not_configured" };
  }
  if (config.config.mode !== "live") return { open: false, reason: "not_configured" };
  try {
    const plans = await listSellablePlans(createBillingDb(config.config, 5000), "live");
    return plans.length ? { open: true, plans: plans.map(toPlanView) } : { open: false, reason: "not_on_sale" };
  } catch (error) {
    const kind = error instanceof BillingStoreError ? error.kind : "error";
    console.error(`[fitx-billing] pricing plans unavailable: ${kind}`);
    if (kind === "missing_schema") return { open: false, reason: "not_configured" };
    if (env.NEXT_PHASE === BUILD_PHASE) return { open: false, reason: "not_on_sale" };
    throw error;
  }
}
