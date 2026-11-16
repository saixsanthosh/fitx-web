import type { NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { verifyCheckout } from "@/lib/billing/checkout";
import { readBillingConfig } from "@/lib/billing/config";
import { createBillingDeps } from "@/lib/billing/deps";
import { noStore } from "@/lib/billing/http";
import { createRouteSupabase } from "@/lib/supabase/route-client";

/**
 * POST the fields Razorpay Checkout's success handler returned -> { verified }.
 * Display only: it lets the page say "payment received, confirming…". It never changes the
 * subscription or grants access; that waits for Razorpay's signed webhook.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return noStore({ error: "forbidden" }, 403);
  const route = createRouteSupabase(request);
  if (!route) return noStore({ error: "unavailable" }, 503);
  const {
    data: { user },
  } = await route.supabase.auth.getUser();
  if (!user) return route.applyTo(noStore({ error: "sign_in_required" }, 401));
  const config = readBillingConfig();
  if (!config.ok) return route.applyTo(noStore({ error: "unavailable" }, 503));

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  const field = (name: string) => (typeof body[name] === "string" ? (body[name] as string) : "");
  try {
    const verified = await verifyCheckout(createBillingDeps(config.config), user.id, {
      paymentId: field("razorpay_payment_id"),
      subscriptionId: field("razorpay_subscription_id"),
      signature: field("razorpay_signature"),
    });
    return route.applyTo(noStore({ verified }));
  } catch (error) {
    console.error(`[fitx-billing] checkout verify failed: ${error instanceof Error ? error.message : "error"}`);
    return route.applyTo(noStore({ error: "verify_failed" }, 500));
  }
}
