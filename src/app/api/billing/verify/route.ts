import type { NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { verifyCheckout } from "@/lib/billing/checkout";
import { readBillingConfig } from "@/lib/billing/config";
import { createBillingDeps } from "@/lib/billing/deps";
import { noStore } from "@/lib/billing/http";
import { readJsonObject } from "@/lib/security/body";
import { takeRouteLimit } from "@/lib/security/rate-limit";
import { bodyErrorResponse, rateLimitedResponse } from "@/lib/security/responses";
import { createRouteSupabase } from "@/lib/supabase/route-client";

/**
 * POST the fields Razorpay Checkout's success handler returned -> { verified }.
 * The browser's fields never change the subscription or grant access. When their signature is genuine,
 * the server reads that subscription from Razorpay itself and records Razorpay's answer (for example
 * "active"); Premium still starts only from the captured payment Razorpay reports.
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

  const limit = takeRouteLimit("billingAction", user.id);
  if (!limit.allowed) return route.applyTo(rateLimitedResponse(limit.retryAfterSeconds));
  const read = await readJsonObject(request, 2048);
  if (!read.ok && read.status === 413) return route.applyTo(bodyErrorResponse(read));
  const body: Record<string, unknown> = read.ok ? read.value : {};
  // Razorpay ids are short and the signature is 64 hex characters; anything longer is not from Checkout.
  const field = (name: string) => (typeof body[name] === "string" && (body[name] as string).length <= 128 ? (body[name] as string) : "");
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
