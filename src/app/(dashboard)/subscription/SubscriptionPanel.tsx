"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";
import { BRAND } from "@/config/brand";
import { formatInr, periodLabel } from "@/lib/billing/money";
import { formatBillingDate, subscriptionStatusLabel, subscriptionTone } from "@/lib/billing/status";
import type { BillingMode, PlanView, SubscriptionView } from "@/lib/billing/types";
import { StatusPill, TestTag } from "./BillingBits";

// Razorpay Standard Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/).
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

type CheckoutSuccess = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
type CheckoutFailure = { error?: { description?: string; reason?: string } };
type RazorpayOptions = {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  image?: string;
  prefill?: { email?: string; name?: string };
  notes?: Record<string, string>;
  theme?: { color: string };
  modal?: { ondismiss?: () => void; confirm_close?: boolean };
  handler: (response: CheckoutSuccess) => void;
};
type RazorpayInstance = { open(): void; on(event: "payment.failed", callback: (response: CheckoutFailure) => void): void };
type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

type CheckoutSession = {
  keyId: string;
  subscriptionId: string;
  mode: BillingMode;
  plan: { code: string; name: string; amountPaise: number; period: PlanView["period"]; interval: number };
  prefill: { email?: string; name?: string };
};

let checkoutScript: Promise<RazorpayConstructor> | null = null;
function loadCheckout(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (!checkoutScript) {
    checkoutScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHECKOUT_SRC;
      script.async = true;
      script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("checkout unavailable")));
      script.onerror = () => {
        checkoutScript = null;
        script.remove();
        reject(new Error("checkout blocked"));
      };
      document.head.appendChild(script);
    });
  }
  return checkoutScript;
}

type Phase =
  | { kind: "idle" }
  | { kind: "starting"; plan: string }
  | { kind: "paying"; plan: string }
  | { kind: "confirming" }
  | { kind: "confirmed" }
  | { kind: "slow" };

/** Every 2 s for the first 90 s, then every 15 s until 15 minutes have passed. */
const FAST_POLL = { every: 2000, until: 90_000 };
const SLOW_POLL = { every: 15_000, until: 15 * 60_000 };

/**
 * Asks the server whether Razorpay has confirmed the payment of this subscription (not whether the
 * account has Premium, which it may still have from an earlier one). Calls onSlow once when the fast
 * phase ends without a confirmation. Returns a function that stops polling.
 */
function pollForConfirmation({
  subscriptionId,
  onConfirmed,
  onSlow,
}: {
  subscriptionId: string;
  onConfirmed: () => void;
  onSlow: () => void;
}): () => void {
  const started = Date.now();
  let timer: number | null = null;
  let stopped = false;
  let slow = false;
  const check = async () => {
    try {
      const response = await fetch(`/api/billing/status?subscription=${encodeURIComponent(subscriptionId)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { confirmed?: boolean } | null;
      if (stopped) return;
      if (response.ok && body?.confirmed === true) return onConfirmed();
    } catch {
      // keep waiting; a network blip is not a failed payment
    }
    if (stopped) return;
    const elapsed = Date.now() - started;
    if (elapsed >= SLOW_POLL.until) return;
    if (!slow && elapsed >= FAST_POLL.until) {
      slow = true;
      onSlow();
    }
    timer = window.setTimeout(check, slow ? SLOW_POLL.every : FAST_POLL.every);
  };
  timer = window.setTimeout(check, FAST_POLL.every);
  return () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
  };
}

const isFuture = (iso: string | null | undefined) => Boolean(iso) && Date.parse(iso!) > Date.now();

/** Razorpay never charges a subscription in these statuses again. */
const ENDED_STATUSES: ReadonlySet<string> = new Set(["cancelled", "completed", "expired"]);

const CHECKOUT_ERRORS: Record<string, string> = {
  already_subscribed: "You already have a subscription. The page has been refreshed to show it.",
  sign_in_required: "Your session has ended. Sign in again to subscribe.",
  unavailable: "Subscriptions aren’t open right now. Nothing was charged.",
  plan_not_found: "That plan is no longer offered. The page has been refreshed.",
  provider_error: "Razorpay didn’t respond. Nothing was charged; try again in a moment.",
};

function priceLine(amountPaise: number | null, period: PlanView["period"] | null, interval: number | null) {
  if (amountPaise === null || !period) return null;
  return `${formatInr(amountPaise)} ${periodLabel(period, interval ?? 1)}`;
}

export function SubscriptionPanel({
  current,
  premium,
  plans,
  checkoutOpen,
  mode,
}: {
  current: SubscriptionView | null;
  premium: boolean;
  plans: PlanView[];
  checkoutOpen: boolean;
  mode: BillingMode | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [notice, setNotice] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const stopPolling = useRef<(() => void) | null>(null);
  const keepSubscriptionRef = useRef<HTMLButtonElement | null>(null);

  const billing = current !== null && ["authenticated", "active", "pending", "halted", "paused"].includes(current.status);
  const canSubscribe = checkoutOpen && !billing;

  // Fetch Checkout ahead of the click, so the Razorpay window opens at once.
  useEffect(() => {
    if (!canSubscribe) return;
    const timer = window.setTimeout(() => void loadCheckout().catch(() => undefined), 800);
    return () => window.clearTimeout(timer);
  }, [canSubscribe]);

  useEffect(() => () => stopPolling.current?.(), []);

  useEffect(() => {
    if (confirmingCancel) keepSubscriptionRef.current?.focus();
  }, [confirmingCancel]);

  function waitForConfirmation(subscriptionId: string) {
    stopPolling.current?.();
    stopPolling.current = pollForConfirmation({
      subscriptionId,
      onConfirmed: () => {
        setPhase({ kind: "confirmed" });
        setNotice({ tone: "success", text: "Razorpay confirmed your payment. Premium is on." });
        router.refresh();
      },
      onSlow: () => {
        setPhase({ kind: "slow" });
        setNotice({
          tone: "info",
          text: "Your payment went through, but Razorpay hasn’t confirmed it to FITX yet. This page keeps checking for a few more minutes, or you can come back later. Please don’t pay again.",
        });
      },
    });
  }

  async function subscribe(plan: PlanView) {
    setNotice(null);
    setPhase({ kind: "starting", plan: plan.code });
    let session: CheckoutSession;
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: plan.code }),
      });
      const body = (await response.json().catch(() => null)) as { checkout?: CheckoutSession; error?: string } | null;
      if (!response.ok || !body?.checkout) {
        const code = body?.error ?? "";
        setPhase({ kind: "idle" });
        setNotice({ tone: "error", text: CHECKOUT_ERRORS[code] ?? "Checkout couldn’t start. Nothing was charged; please try again." });
        if (code === "already_subscribed" || code === "plan_not_found") router.refresh();
        return;
      }
      session = body.checkout;
    } catch {
      setPhase({ kind: "idle" });
      setNotice({ tone: "error", text: "Checkout couldn’t start. Check your connection and try again." });
      return;
    }

    let Razorpay: RazorpayConstructor;
    try {
      Razorpay = await loadCheckout();
    } catch {
      setPhase({ kind: "idle" });
      setNotice({
        tone: "error",
        text: "Razorpay Checkout couldn’t load. Check your connection, or allow checkout.razorpay.com if a content blocker is on.",
      });
      return;
    }

    const checkout = new Razorpay({
      key: session.keyId,
      subscription_id: session.subscriptionId,
      name: "FITX",
      description: `${session.plan.name} · ${formatInr(session.plan.amountPaise)} ${periodLabel(session.plan.period, session.plan.interval)}`,
      image: new URL("/brand/fitx-app-icon.png", window.location.origin).href,
      prefill: session.prefill,
      notes: { fitx_plan: session.plan.code },
      theme: { color: BRAND.primaryColor },
      modal: {
        confirm_close: true,
        ondismiss: () => {
          setPhase((previous) => (previous.kind === "paying" ? { kind: "idle" } : previous));
          setNotice((previous) => previous ?? { tone: "info", text: "Checkout closed." });
        },
      },
      handler: (result) => {
        setPhase({ kind: "confirming" });
        setNotice({ tone: "info", text: "Payment received. Waiting for Razorpay to confirm it…" });
        // Display only: access is granted from Razorpay's signed webhook, not from this response.
        void fetch("/api/billing/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(result),
        }).catch(() => undefined);
        // The id FITX's server issued for this checkout, not the one Checkout handed back.
        waitForConfirmation(session.subscriptionId);
      },
    });
    checkout.on("payment.failed", (failure) => {
      const reason = failure.error?.description?.trim();
      setNotice({
        tone: "error",
        text: `${reason ? `Payment failed: ${reason}` : "The payment failed."} You can try again or choose another method in the Razorpay window.`,
      });
    });
    setPhase({ kind: "paying", plan: plan.code });
    checkout.open();
  }

  async function cancel() {
    setCancelling(true);
    setNotice(null);
    try {
      const response = await fetch("/api/billing/cancel", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { status?: string; accessUntil?: string | null; error?: string } | null;
      // Only a subscription Razorpay reports as ended stops the charges.
      if (response.ok && ENDED_STATUSES.has(body?.status ?? "")) {
        const until = formatBillingDate(body?.accessUntil ?? null);
        setNotice({
          tone: "success",
          text: until && isFuture(body?.accessUntil)
            ? `Renewal cancelled. You won’t be charged again, and Premium stays on until ${until}.`
            : "Subscription cancelled. You won’t be charged again.",
        });
        setConfirmingCancel(false);
        // A checkout finished earlier in this visit no longer hides the plans.
        setPhase({ kind: "idle" });
        router.refresh();
      } else if (body?.error === "nothing_to_cancel") {
        setConfirmingCancel(false);
        router.refresh();
      } else if (body?.error === "still_billing") {
        setNotice({
          tone: "error",
          text: "Razorpay didn’t cancel the subscription, so it still renews. Try again in a minute; if this keeps happening, contact FITX support.",
        });
      } else {
        setNotice({
          tone: "error",
          text: "FITX couldn’t confirm the cancellation with Razorpay. Reload this page to see whether it went through before trying again.",
        });
      }
    } catch {
      setNotice({
        tone: "error",
        text: "FITX couldn’t be reached. Check your connection, then reload this page to see whether the cancellation went through.",
      });
    } finally {
      setCancelling(false);
    }
  }

  const busy = phase.kind === "starting" || phase.kind === "paying" || phase.kind === "confirming";

  return (
    <div className="space-y-5">
      {mode === "test" && (
        <p className="fitx-alert text-fitx-text-secondary" role="note">
          <strong className="text-fitx-text">Test mode.</strong> Razorpay test payments only; no real money moves.
        </p>
      )}

      {current && <CurrentSubscription
        current={current}
        premium={premium}
        billing={billing}
        canChange={mode !== null}
        confirmingCancel={confirmingCancel}
        cancelling={cancelling}
        onAskCancel={() => setConfirmingCancel(true)}
        onKeep={() => setConfirmingCancel(false)}
        onCancel={cancel}
        keepRef={keepSubscriptionRef}
      />}

      <div aria-live="polite" role="status">
        {notice && (
          <p
            className={`fitx-alert ${notice.tone === "error" ? "fitx-alert-danger" : notice.tone === "success" ? "fitx-alert-success" : ""}`}
          >
            {notice.text}
          </p>
        )}
      </div>

      {canSubscribe && phase.kind !== "confirmed" && (
        <section aria-labelledby="subscription-plans" className="space-y-3">
          <div>
            <h2 id="subscription-plans" className="text-base font-semibold text-fitx-text">
              {current ? "Subscribe again" : "Choose a plan"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-fitx-text-secondary">
              Renews automatically until you cancel. Cancelling stops future charges; Premium lasts until the end of the period you paid for.
              {premium && current?.paidUntil ? ` Your current access runs until ${formatBillingDate(current.paidUntil)}; a new subscription is charged right away.` : ""}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((plan) => {
              const starting = phase.kind === "starting" && phase.plan === plan.code;
              const paying = phase.kind === "paying" && phase.plan === plan.code;
              return (
                <article key={plan.id} className="fitx-panel flex flex-col p-5">
                  <h3 className="text-sm font-semibold text-fitx-text">{plan.name}</h3>
                  <p className="mt-3 flex items-baseline gap-1.5">
                    <span className="text-3xl font-semibold tracking-tight tabular-nums text-fitx-text">{formatInr(plan.amountPaise)}</span>
                    <span className="text-sm text-fitx-text-secondary">{periodLabel(plan.period, plan.interval)}</span>
                  </p>
                  {plan.description && <p className="mt-3 text-sm leading-6 text-fitx-text-secondary">{plan.description}</p>}
                  {plan.features.length > 0 && (
                    <ul className="mt-3 space-y-2 text-sm text-fitx-text">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex gap-2">
                          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fitx-success" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="fitx-button mt-5 min-h-11 w-full"
                    onClick={() => void subscribe(plan)}
                    disabled={busy}
                  >
                    {starting || paying ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
                    {starting ? "Opening Razorpay…" : paying ? "Complete payment in Razorpay" : "Subscribe"}
                    <span className="sr-only">{` to ${plan.name}, ${formatInr(plan.amountPaise)} ${periodLabel(plan.period, plan.interval)}`}</span>
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {(phase.kind === "confirming" || phase.kind === "slow") && (
        <p className="flex items-center gap-2 text-sm text-fitx-text-secondary">
          {phase.kind === "confirming" && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
          {phase.kind === "confirming" ? "Confirming with Razorpay…" : "Still waiting for Razorpay’s confirmation."}
        </p>
      )}
    </div>
  );
}

function CurrentSubscription({
  current,
  premium,
  billing,
  canChange,
  confirmingCancel,
  cancelling,
  onAskCancel,
  onKeep,
  onCancel,
  keepRef,
}: {
  current: SubscriptionView;
  premium: boolean;
  billing: boolean;
  canChange: boolean;
  confirmingCancel: boolean;
  cancelling: boolean;
  onAskCancel: () => void;
  onKeep: () => void;
  onCancel: () => void;
  keepRef: RefObject<HTMLButtonElement | null>;
}) {
  const paidUntil = formatBillingDate(current.paidUntil);
  const chargeAt = formatBillingDate(current.chargeAt);
  const price = priceLine(current.amountPaise, current.period, current.interval);
  const amount = current.amountPaise !== null ? formatInr(current.amountPaise) : null;

  let summary: string;
  switch (current.status) {
    case "active":
      summary = premium
        ? `Premium is on.${chargeAt ? ` Renews on ${chargeAt}${amount ? ` for ${amount}` : ""}.` : ""}`
        : "Razorpay has activated the subscription. Premium starts once the payment is confirmed.";
      break;
    case "authenticated":
      summary = "Your payment method is set up. Premium starts once Razorpay confirms the first payment.";
      break;
    case "pending":
      summary = `Your renewal payment didn’t go through and Razorpay is retrying it.${premium ? " Premium stays on for up to 3 days after your paid period ends." : ""}`;
      break;
    case "halted":
      summary = "Razorpay stopped retrying the renewal payment, so Premium has ended. Cancel this subscription, then subscribe again with another payment method.";
      break;
    case "paused":
      summary = "This subscription is paused, so no payments are taken. Contact FITX support to resume it.";
      break;
    case "cancelled":
      summary = premium && paidUntil ? `Cancelled. You won’t be charged again; Premium stays on until ${paidUntil}.` : "Cancelled. Premium has ended and you won’t be charged again.";
      break;
    case "completed":
      summary = premium && paidUntil ? `All billing cycles are complete. Premium stays on until ${paidUntil}.` : "All billing cycles are complete.";
      break;
    default:
      summary = "This subscription has ended.";
  }

  return (
    <section className="fitx-panel p-5 sm:p-6" aria-labelledby="current-subscription">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-fitx-primary-text">Your subscription</p>
          <h2 id="current-subscription" className="mt-2 text-xl font-semibold tracking-tight text-fitx-text">
            {current.planName ?? "FITX Premium"}
          </h2>
          {price && <p className="mt-1 text-sm text-fitx-text-secondary">{price}</p>}
        </div>
        <div className="flex items-center gap-2">
          {current.mode === "test" && <TestTag />}
          <StatusPill tone={premium ? "good" : subscriptionTone(current.status)}>
            {premium && current.status !== "active" ? "Premium on" : subscriptionStatusLabel(current.status)}
          </StatusPill>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-fitx-text">{summary}</p>
      {paidUntil && premium && current.status === "active" && (
        <p className="mt-1 text-xs text-fitx-text-secondary">Paid through {paidUntil}.</p>
      )}

      {billing && !canChange && (
        <p className="mt-5 border-t border-fitx-divider pt-4 text-sm text-fitx-text-secondary">
          Subscription changes are unavailable right now. To cancel, email FITX support.
        </p>
      )}
      {billing && canChange && (
        <div className="mt-5 border-t border-fitx-divider pt-4">
          {!confirmingCancel ? (
            <button type="button" className="fitx-button fitx-button-quiet min-h-11" onClick={onAskCancel}>
              Cancel subscription
            </button>
          ) : (
            <div className="space-y-3" role="group" aria-labelledby="cancel-question">
              <p id="cancel-question" className="text-sm leading-6 text-fitx-text">
                Stop renewals? Razorpay won’t charge you again.
                {premium && paidUntil ? ` You keep Premium until ${paidUntil}.` : ""} This can’t be undone, but you can subscribe again later.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="fitx-button fitx-button-danger min-h-11" onClick={onCancel} disabled={cancelling}>
                  {cancelling && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                  {cancelling ? "Cancelling…" : "Yes, cancel renewal"}
                </button>
                <button ref={keepRef} type="button" className="fitx-button fitx-button-secondary min-h-11" onClick={onKeep} disabled={cancelling}>
                  Keep subscription
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
