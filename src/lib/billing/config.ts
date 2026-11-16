import "server-only";
import type { BillingMode } from "./types";

/**
 * Billing turns on only when every server-side secret it needs is present. Without them the pages
 * say "Subscriptions open soon" and no checkout can start. Values never leave the server; only the
 * Razorpay key id (public by design, it opens Checkout) is sent to the browser.
 *
 *   RAZORPAY_KEY_ID          rzp_test_… (test mode) or rzp_live_… (live mode)
 *   RAZORPAY_KEY_SECRET      the secret of that key
 *   RAZORPAY_WEBHOOK_SECRET  the secret set on the Razorpay webhook for /api/billing/webhook
 *   SUPABASE_SECRET_KEY      server key for writing billing records (SUPABASE_SERVICE_ROLE_KEY also works)
 *   CRON_SECRET              protects /api/billing/reconcile (Vercel Cron sends it as a Bearer token)
 *   BILLING_TEST_EMAILS      test mode only: the accounts allowed to check out with Razorpay test cards
 */

export type BillingConfig = {
  mode: BillingMode;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  supabaseUrl: string;
  serverKey: string;
  cronSecret: string | null;
  testEmails: ReadonlySet<string>;
  apiBase: string;
};

export type BillingUnavailableReason =
  | "razorpay_keys_missing"
  | "razorpay_key_invalid"
  | "webhook_secret_missing"
  | "supabase_missing"
  | "server_key_missing";

export type BillingConfigResult =
  | { ok: true; config: BillingConfig }
  | { ok: false; reason: BillingUnavailableReason };

type Env = Record<string, string | undefined>;

export const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

const clean = (value: string | undefined) => (value ?? "").trim();

/** Tests point the client at a local fake; anything that is not a loopback http URL is ignored. */
function apiBase(env: Env): string {
  const custom = clean(env.RAZORPAY_API_BASE);
  if (!custom) return RAZORPAY_API_BASE;
  try {
    const url = new URL(custom);
    if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
      return url.href.replace(/\/$/, "");
    }
  } catch {
    // fall through
  }
  return RAZORPAY_API_BASE;
}

export function modeOfKey(keyId: string): BillingMode | null {
  if (/^rzp_test_[A-Za-z0-9]+$/.test(keyId)) return "test";
  if (/^rzp_live_[A-Za-z0-9]+$/.test(keyId)) return "live";
  return null;
}

export function parseEmailList(value: string | undefined): ReadonlySet<string> {
  return new Set(
    clean(value)
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
  );
}

export function readBillingConfig(env: Env = process.env): BillingConfigResult {
  const keyId = clean(env.RAZORPAY_KEY_ID);
  const keySecret = clean(env.RAZORPAY_KEY_SECRET);
  if (!keyId || !keySecret) return { ok: false, reason: "razorpay_keys_missing" };
  const mode = modeOfKey(keyId);
  if (!mode) return { ok: false, reason: "razorpay_key_invalid" };
  const webhookSecret = clean(env.RAZORPAY_WEBHOOK_SECRET);
  if (!webhookSecret) return { ok: false, reason: "webhook_secret_missing" };
  const supabaseUrl = clean(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!supabaseUrl) return { ok: false, reason: "supabase_missing" };
  const serverKey = clean(env.SUPABASE_SECRET_KEY) || clean(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!serverKey) return { ok: false, reason: "server_key_missing" };
  return {
    ok: true,
    config: {
      mode,
      keyId,
      keySecret,
      webhookSecret,
      supabaseUrl,
      serverKey,
      cronSecret: clean(env.CRON_SECRET) || null,
      testEmails: parseEmailList(env.BILLING_TEST_EMAILS),
      apiBase: apiBase(env),
    },
  };
}

/**
 * Live mode is open to every signed-in account. Test mode is limited to BILLING_TEST_EMAILS, because
 * Razorpay's test cards are public and would otherwise unlock Premium for anyone.
 */
export function checkoutAllowedFor(config: BillingConfig, email: string | null | undefined): boolean {
  if (config.mode === "live") return true;
  return Boolean(email) && config.testEmails.has(email!.trim().toLowerCase());
}

const loggedReasons = new Set<string>();
/** One server log line per reason and process, so an unconfigured deployment is easy to spot. */
export function logBillingUnavailable(reason: BillingUnavailableReason) {
  if (loggedReasons.has(reason)) return;
  loggedReasons.add(reason);
  console.warn(`[fitx-billing] subscriptions are closed: ${reason.replaceAll("_", " ")}`);
}
