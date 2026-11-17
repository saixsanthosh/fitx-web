import type { NextRequest } from "next/server";
import { readBillingConfig } from "@/lib/billing/config";
import { isMissingBillingSchema } from "@/lib/billing/db";
import { noStore } from "@/lib/billing/http";
import { isRazorpayId } from "@/lib/billing/ids";
import { isSubscriptionStatus, LIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/types";
import { createRouteSupabase } from "@/lib/supabase/route-client";

type StatusRow = { status: string; paid_until: string | null; charge_at: string | null; abandoned_at: string | null };

/**
 * GET -> { premium, subscription } for the signed-in account, read with the account's own session
 * (row-level security).
 * GET ?subscription=<Razorpay id> also answers { confirmed }: whether Razorpay has confirmed the payment
 * of that subscription of this account. The page polls it after Checkout; Premium the account already
 * had (for example a cancelled subscription's paid period) never counts as the new payment.
 */
export async function GET(request: NextRequest) {
  const route = createRouteSupabase(request);
  if (!route) return noStore({ error: "unavailable" }, 503);
  const {
    data: { user },
  } = await route.supabase.auth.getUser();
  if (!user) return route.applyTo(noStore({ error: "sign_in_required" }, 401));

  const config = readBillingConfig();
  let query = route.supabase
    .from("billing_subscriptions")
    .select("status,mode,paid_until,charge_at,abandoned_at,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (config.ok) query = query.eq("mode", config.config.mode);

  const watched = request.nextUrl.searchParams.get("subscription");
  const watchedQuery =
    watched !== null && isRazorpayId("subscription", watched)
      ? route.supabase
          .from("billing_subscriptions")
          .select("status,paid_until")
          .eq("user_id", user.id)
          .eq("provider_subscription_id", watched)
          .limit(1)
      : null;

  const [subscriptions, premium, watchedRows] = await Promise.all([
    query,
    route.supabase.rpc("has_premium", { p_user_id: user.id }),
    watchedQuery,
  ]);
  const error = subscriptions.error ?? premium.error ?? watchedRows?.error;
  if (error) {
    if (isMissingBillingSchema(error)) {
      return route.applyTo(noStore({ premium: false, subscription: null, installed: false, ...(watched !== null ? { confirmed: false } : {}) }));
    }
    return route.applyTo(noStore({ error: "status_unavailable" }, 500));
  }

  const rows = (subscriptions.data ?? []) as StatusRow[];
  const visible = rows.filter((row) => isSubscriptionStatus(row.status) && !(row.status === "created" && row.abandoned_at));
  const current =
    visible.find((row) => LIVE_SUBSCRIPTION_STATUSES.has(row.status as never)) ?? visible.find((row) => row.status !== "created") ?? visible[0] ?? null;
  const body: Record<string, unknown> = {
    premium: premium.data === true,
    subscription: current ? { status: current.status, paidUntil: current.paid_until, chargeAt: current.charge_at } : null,
  };
  if (watched !== null) {
    // paid_until is set only from a captured payment of that subscription, applied from a signed
    // webhook or the server's own Razorpay read; "created" means Razorpay has not reported it yet.
    const row = (watchedRows?.data?.[0] ?? null) as Pick<StatusRow, "status" | "paid_until"> | null;
    body.confirmed = Boolean(row && row.status !== "created" && row.paid_until && Date.parse(row.paid_until) > Date.now());
  }
  return route.applyTo(noStore(body));
}
