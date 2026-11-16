import "server-only";
import {
  applyBillingEvent,
  BillingStoreError,
  listReconcileCandidates,
  listSubscriptionPayments,
  recordReconciliationRun,
  type ReconcileCandidate,
} from "./db";
import type { BillingDeps } from "./deps";
import { normalizeInvoice, normalizePayment, normalizeRefund, normalizeSubscription, trimForStorage } from "./events";
import { RazorpayApiError } from "./razorpay";
import type { BillingMode } from "./types";

export type ReconcileSummary = {
  mode: BillingMode;
  startedAt: string;
  candidates: number;
  checked: number;
  corrections: number;
  errors: number;
  /** True when the time budget ran out; the rest is checked first on the next run. */
  remaining: boolean;
};

/** A captured payment is looked at again while a refund is still plausible. */
const REFUND_WINDOW_MS = 40 * 24 * 60 * 60 * 1000;
/** Payment lookups per subscription and run, so one long history cannot use up the run. */
const MAX_PAYMENT_LOOKUPS = 6;

/**
 * Nightly comparison with Razorpay. For each candidate (subscriptions Razorpay may still bill and open
 * checkouts first, then ones that ended in the last 40 days, then replaced checkouts; see
 * billing_reconcile_candidates), it reads the subscription, its invoices and (where needed) payments
 * and refunds from Razorpay's API with the server's secret key, and applies them through the same
 * billing_apply_event() as webhooks. A missed or failed webhook is repaired here; anything already
 * applied is a no-op.
 */
export async function reconcileSubscriptions(
  deps: BillingDeps,
  { limit = 100, budgetMs = 45_000 }: { limit?: number; budgetMs?: number } = {},
): Promise<ReconcileSummary> {
  const { mode } = deps.config;
  const started = deps.now();
  const runId = started.toISOString();
  const candidates = await listReconcileCandidates(deps.db, mode, limit);
  let checked = 0;
  let corrections = 0;
  let errors = 0;
  const errorKinds: Record<string, number> = {};

  for (const candidate of candidates) {
    if (deps.now().getTime() - started.getTime() > budgetMs) break;
    checked += 1;
    try {
      corrections += await reconcileOne(deps, candidate, runId);
    } catch (error) {
      errors += 1;
      const kind =
        error instanceof RazorpayApiError ? `razorpay_${error.status}` : error instanceof BillingStoreError ? `database_${error.kind}` : "other";
      errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;
      console.error(`[fitx-billing] reconcile: one subscription failed (${kind})`);
    }
  }

  const summary: ReconcileSummary = {
    mode,
    startedAt: runId,
    candidates: candidates.length,
    checked,
    corrections,
    errors,
    remaining: checked < candidates.length,
  };
  await recordReconciliationRun(deps.db, {
    mode,
    started_at: runId,
    subscriptions_checked: checked,
    corrections,
    errors,
    detail: { candidates: candidates.length, remaining: summary.remaining, errors: errorKinds },
  });
  return summary;
}

async function reconcileOne(deps: BillingDeps, candidate: ReconcileCandidate, runId: string): Promise<number> {
  const { mode } = deps.config;
  const entity = await deps.razorpay.fetchSubscription(candidate.provider_subscription_id);
  const snapshot = normalizeSubscription(entity);
  if (!snapshot || snapshot.provider_subscription_id !== candidate.provider_subscription_id) {
    throw new RazorpayApiError("Razorpay returned an unexpected subscription", 502, "FITX_UNEXPECTED");
  }
  const readAt = () => deps.now().toISOString();
  let corrections = 0;

  const applied = await applyBillingEvent(deps.db, {
    event_id: `reconcile:${runId}:${snapshot.provider_subscription_id}`,
    source: "reconcile",
    event_type: "fitx.reconcile.subscription",
    mode,
    event_created_at: readAt(),
    payload: { subscription: trimForStorage(entity) } as Record<string, unknown>,
    subscription: snapshot,
  });
  if (applied.outcome === "applied" && applied.statusBefore !== applied.statusAfter) corrections += 1;

  const invoices = (await deps.razorpay.listSubscriptionInvoices(snapshot.provider_subscription_id))
    .map(normalizeInvoice)
    .filter((invoice) => invoice?.payment_id);
  if (!invoices.length) return corrections;

  const known = new Map((await listSubscriptionPayments(deps.db, candidate.id)).map((payment) => [payment.provider_payment_id, payment]));
  const now = deps.now().getTime();
  let lookups = 0;
  for (const invoice of invoices) {
    const paymentId = invoice!.payment_id!;
    const existing = known.get(paymentId);
    if (existing?.status === "refunded" || existing?.status === "failed") continue;
    const recent = invoice!.billing_end ? now - Date.parse(invoice!.billing_end) < REFUND_WINDOW_MS : true;
    if (existing?.status === "captured" && !recent) continue;
    if (lookups >= MAX_PAYMENT_LOOKUPS) break;
    lookups += 1;

    const paymentEntity = await deps.razorpay.fetchPayment(paymentId);
    const payment = normalizePayment(paymentEntity);
    if (!payment) continue;
    const result = await applyBillingEvent(deps.db, {
      event_id: `reconcile:${runId}:${payment.provider_payment_id}`,
      source: "reconcile",
      event_type: "fitx.reconcile.payment",
      mode,
      event_created_at: readAt(),
      payload: { payment: trimForStorage(paymentEntity) } as Record<string, unknown>,
      payment: {
        ...payment,
        provider_subscription_id: snapshot.provider_subscription_id,
        period_start: invoice!.billing_start,
        period_end: invoice!.billing_end,
      },
    });
    if (result.paymentCreated || (existing && existing.status !== payment.status)) corrections += 1;

    if (payment.amount_refunded_paise > (existing?.amount_refunded_paise ?? 0)) {
      corrections += 1;
      for (const refundEntity of await deps.razorpay.listPaymentRefunds(payment.provider_payment_id)) {
        const refund = normalizeRefund(refundEntity);
        if (!refund) continue;
        await applyBillingEvent(deps.db, {
          event_id: `reconcile:${runId}:${refund.provider_refund_id}`,
          source: "reconcile",
          event_type: "fitx.reconcile.refund",
          mode,
          event_created_at: readAt(),
          payload: { refund: trimForStorage(refundEntity) } as Record<string, unknown>,
          refund,
        });
      }
    }
  }
  return corrections;
}
