import "server-only";
import { logBillingUnavailable, readBillingConfig } from "./config";
import { BillingStoreError, createBillingDb, listSellablePlans, toPlanView } from "./db";
import type { PlanView } from "./types";

export type PublicCatalog = { open: true; plans: PlanView[] } | { open: false };

/**
 * Plans for the public pricing page, read on the server with the secret key (anon has no access to
 * billing tables). Subscriptions are shown as open only in live mode with at least one active plan:
 * test mode is for the owner's testers, not the public.
 */
export async function loadPublicCatalog(): Promise<PublicCatalog> {
  const config = readBillingConfig();
  if (!config.ok) {
    logBillingUnavailable(config.reason);
    return { open: false };
  }
  if (config.config.mode !== "live") return { open: false };
  try {
    const plans = await listSellablePlans(createBillingDb(config.config, 5000), "live");
    return plans.length ? { open: true, plans: plans.map(toPlanView) } : { open: false };
  } catch (error) {
    console.error(`[fitx-billing] pricing plans unavailable: ${error instanceof BillingStoreError ? error.kind : "error"}`);
    return { open: false };
  }
}
