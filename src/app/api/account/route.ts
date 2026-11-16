import { NextResponse, type NextRequest } from "next/server";
import { accountDeletionConfigured, createAdminClient, removeUserFiles } from "@/lib/account/admin";
import { DELETE_CONFIRMATION, isRecentSignIn, RECENT_SIGN_IN_MINUTES, sessionSignedInAt, type DeletionStatus } from "@/lib/account/deletion";
import { AUTH_HINT_COOKIE, hintCookieOptions, ONBOARDED_COOKIE, SESSION_COOKIE_RE, sessionCookieOptions } from "@/lib/auth/cookies";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { cancelForUser } from "@/lib/billing/cancel";
import { readBillingConfig } from "@/lib/billing/config";
import { createBillingDeps } from "@/lib/billing/deps";
import { createRouteSupabase } from "@/lib/supabase/route-client";

/**
 * GET    whether this account can be deleted right now (configured, and a recent enough sign-in).
 * DELETE deletes the signed-in account: it stops Razorpay renewals (when billing is configured), removes
 *        its files in private storage, then the login itself, which removes every FITX row (user tables
 *        cascade from auth.users; billing records stay, without the link to the person, as the money
 *        trail). Body: { "confirm": "DELETE" }.
 * The account is always the session's own; nothing in the request can name another one.
 */

const json = (body: unknown, status = 200) => {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

async function readSession(request: NextRequest) {
  const route = createRouteSupabase(request);
  if (!route) return null;
  const { data: claimsData } = await route.supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) return { route, user: null, signedInAt: null };
  // Ask Supabase Auth too: the account must still exist and match the token.
  const { data, error } = await route.supabase.auth.getUser();
  if (error || !data.user || data.user.id !== userId) return { route, user: null, signedInAt: null };
  return { route, user: data.user, signedInAt: sessionSignedInAt(claims, data.user.last_sign_in_at) };
}

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  const session = await readSession(request);
  if (!session) return json({ error: "unavailable" }, 503);
  if (!session.user) return session.route.applyTo(json({ error: "signed_out" }, 401));
  const deletion: DeletionStatus = {
    available: accountDeletionConfigured(),
    recentSignIn: isRecentSignIn(session.signedInAt),
    signedInAt: session.signedInAt,
    windowMinutes: RECENT_SIGN_IN_MINUTES,
  };
  return session.route.applyTo(json({ deletion }));
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  const session = await readSession(request);
  if (!session) return json({ error: "unavailable" }, 503);
  const { route, user } = session;
  if (!user) return route.applyTo(json({ error: "signed_out" }, 401));

  const admin = createAdminClient();
  if (!admin) return route.applyTo(json({ error: "not_configured" }, 503));

  let body: { confirm?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  if (body?.confirm !== DELETE_CONFIRMATION) return route.applyTo(json({ error: "confirmation_required" }, 400));
  if (!isRecentSignIn(session.signedInAt)) {
    return route.applyTo(json({ error: "reauth_required", windowMinutes: RECENT_SIGN_IN_MINUTES }, 403));
  }

  // Razorpay would keep charging a deleted account, so renewals stop first; if they can't be stopped,
  // nothing is deleted and the member can try again.
  const billing = await stopBilling(user.id);
  if (!billing.stopped) {
    console.warn("[fitx-account] Razorpay renewals could not be stopped; the account was kept", billing.reason);
    return route.applyTo(json({ error: "billing_not_stopped" }, 502));
  }

  const files = await removeUserFiles(admin, user.id);
  if (files.error) {
    console.warn("[fitx-account] private files were not removed; the account was kept", codeOf(files.error));
    return route.applyTo(json({ error: "files_not_deleted" }, 502));
  }
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.warn("[fitx-account] the login could not be deleted", codeOf(error));
    return route.applyTo(json({ error: "delete_failed" }, 502));
  }

  // The login is gone: end the session on this device. (route.applyTo is skipped on purpose, so a
  // token refresh during this request can't put the session cookies back.)
  const response = json({ deleted: true, removedFiles: files.removed });
  for (const cookie of request.cookies.getAll()) {
    if (SESSION_COOKIE_RE.test(cookie.name)) response.cookies.set(cookie.name, "", { ...sessionCookieOptions(route.secure), maxAge: 0 });
  }
  response.cookies.set(AUTH_HINT_COOKIE, "", hintCookieOptions(route.secure, { maxAge: 0 }));
  response.cookies.set(ONBOARDED_COOKIE, "", hintCookieOptions(route.secure, { httpOnly: true, maxAge: 0 }));
  return response;
}

/** Cancels the account's live Razorpay subscription when billing is configured (nothing to do otherwise). */
async function stopBilling(userId: string): Promise<{ stopped: true } | { stopped: false; reason: string }> {
  const billing = readBillingConfig();
  if (!billing.ok) return { stopped: true };
  try {
    const outcome = await cancelForUser(createBillingDeps(billing.config), userId);
    // "unavailable": the billing tables don't exist yet, so there is no subscription to stop.
    if (outcome.kind === "provider_error") return { stopped: false, reason: outcome.retryable ? "razorpay_retryable" : "razorpay" };
    return { stopped: true };
  } catch (error) {
    return { stopped: false, reason: error instanceof Error ? error.name : codeOf(error) };
  }
}

function codeOf(error: unknown) {
  const value = error as { code?: unknown; status?: unknown; statusCode?: unknown } | null;
  return String(value?.code ?? value?.status ?? value?.statusCode ?? "unknown");
}
