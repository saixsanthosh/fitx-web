import type { NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { PLAN_CODE_RE, startCheckout } from "@/lib/billing/checkout";
import { checkoutAllowedFor, logBillingUnavailable, readBillingConfig } from "@/lib/billing/config";
import { createBillingDeps } from "@/lib/billing/deps";
import { displayName, noStore } from "@/lib/billing/http";
import { readJsonObject } from "@/lib/security/body";
import { takeRouteLimit } from "@/lib/security/rate-limit";
import { bodyErrorResponse, rateLimitedResponse } from "@/lib/security/responses";
import { createRouteSupabase } from "@/lib/supabase/route-client";

export const maxDuration = 20;

/**
 * POST { plan: "<plan code>" } -> { checkout } with what Razorpay Checkout needs to open for this account.
 * Creating the subscription grants nothing; Premium starts only when Razorpay confirms the payment.
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
  if (!config.ok) {
    logBillingUnavailable(config.reason);
    return route.applyTo(noStore({ error: "unavailable" }, 503));
  }
  if (!checkoutAllowedFor(config.config, user.email)) return route.applyTo(noStore({ error: "unavailable" }, 503));

  // Each new checkout creates a Razorpay subscription: a short per-account limit here, the daily one in startCheckout.
  const limit = takeRouteLimit("checkout", user.id);
  if (!limit.allowed) return route.applyTo(rateLimitedResponse(limit.retryAfterSeconds));
  const read = await readJsonObject(request, 1024);
  if (!read.ok && read.status === 413) return route.applyTo(bodyErrorResponse(read));
  const plan: unknown = read.ok ? read.value.plan : null;
  if (typeof plan !== "string" || !PLAN_CODE_RE.test(plan)) return route.applyTo(noStore({ error: "invalid_plan" }, 400));

  try {
    const outcome = await startCheckout(createBillingDeps(config.config), { id: user.id, email: user.email ?? null, name: displayName(user) }, plan);
    switch (outcome.kind) {
      case "ready":
        return route.applyTo(noStore({ checkout: outcome.session }));
      case "already_subscribed":
        return route.applyTo(noStore({ error: "already_subscribed" }, 409));
      case "plan_not_found":
        return route.applyTo(noStore({ error: "plan_not_found" }, 404));
      case "plan_unavailable":
      case "unavailable":
        return route.applyTo(noStore({ error: "unavailable" }, 503));
      case "rate_limited": {
        const response = noStore({ error: "rate_limited" }, 429);
        response.headers.set("Retry-After", String(outcome.retryAfterSeconds));
        return route.applyTo(response);
      }
      case "provider_error":
        return route.applyTo(noStore({ error: "provider_error", retryable: outcome.retryable }, 502));
    }
  } catch (error) {
    console.error(`[fitx-billing] checkout failed: ${error instanceof Error ? error.message : "error"}`);
    return route.applyTo(noStore({ error: "checkout_failed" }, 500));
  }
}
