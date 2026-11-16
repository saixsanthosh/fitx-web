import type { NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { cancelForUser } from "@/lib/billing/cancel";
import { logBillingUnavailable, readBillingConfig } from "@/lib/billing/config";
import { createBillingDeps } from "@/lib/billing/deps";
import { noStore } from "@/lib/billing/http";
import { createRouteSupabase } from "@/lib/supabase/route-client";

export const maxDuration = 20;

/** POST -> stops renewals of the signed-in account's subscription; Premium lasts to the end of the paid period. */
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

  try {
    const outcome = await cancelForUser(createBillingDeps(config.config), user.id);
    switch (outcome.kind) {
      case "cancelled":
        return route.applyTo(noStore({ status: outcome.status, accessUntil: outcome.accessUntil }));
      case "nothing_to_cancel":
        return route.applyTo(noStore({ error: "nothing_to_cancel" }, 404));
      case "unavailable":
        return route.applyTo(noStore({ error: "unavailable" }, 503));
      case "provider_error":
        return route.applyTo(noStore({ error: "provider_error", retryable: outcome.retryable }, 502));
    }
  } catch (error) {
    console.error(`[fitx-billing] cancel failed: ${error instanceof Error ? error.message : "error"}`);
    return route.applyTo(noStore({ error: "cancel_failed" }, 500));
  }
}
