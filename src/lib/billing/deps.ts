import "server-only";
import type { BillingConfig } from "./config";
import { createBillingDb, type BillingDb } from "./db";
import { createRazorpayClient, type RazorpayClient } from "./razorpay";

/** Everything a billing operation needs, passed in so tests can point it at local fakes. */
export type BillingDeps = {
  config: BillingConfig;
  db: BillingDb;
  razorpay: RazorpayClient;
  now: () => Date;
};

export function createBillingDeps(
  config: BillingConfig,
  { dbTimeoutMs = 8000, razorpayTimeoutMs = 8000 }: { dbTimeoutMs?: number; razorpayTimeoutMs?: number } = {},
): BillingDeps {
  return {
    config,
    db: createBillingDb(config, dbTimeoutMs),
    razorpay: createRazorpayClient({ keyId: config.keyId, keySecret: config.keySecret, apiBase: config.apiBase, timeoutMs: razorpayTimeoutMs }),
    now: () => new Date(),
  };
}
