import type { NextRequest } from "next/server";
import { readBillingConfig } from "@/lib/billing/config";
import { isMissingBillingSchema } from "@/lib/billing/db";
import { noStore } from "@/lib/billing/http";
import { isSubscriptionStatus, LIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/types";
import { createRouteSupabase } from "@/lib/supabase/route-client";

/**
 * GET -> { premium, subscription } for the signed-in account, read with the account's own session
 * (row-level security). The page polls it after Checkout until Razorpay's webhook has confirmed the payment.
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
  const [subscriptions, premium] = await Promise.all([query, route.supabase.rpc("has_premium", { p_user_id: user.id })]);
  const error = subscriptions.error ?? premium.error;
  if (error) {
    if (isMissingBillingSchema(error)) return route.applyTo(noStore({ premium: false, subscription: null, installed: false }));
    return route.applyTo(noStore({ error: "status_unavailable" }, 500));
  }

  const rows = (subscriptions.data ?? []) as Array<{ status: string; paid_until: string | null; charge_at: string | null; abandoned_at: string | null }>;
  const visible = rows.filter((row) => isSubscriptionStatus(row.status) && !(row.status === "created" && row.abandoned_at));
  const current =
    visible.find((row) => LIVE_SUBSCRIPTION_STATUSES.has(row.status as never)) ?? visible.find((row) => row.status !== "created") ?? visible[0] ?? null;
  return route.applyTo(
    noStore({
      premium: premium.data === true,
      subscription: current ? { status: current.status, paidUntil: current.paid_until, chargeAt: current.charge_at } : null,
    }),
  );
}
