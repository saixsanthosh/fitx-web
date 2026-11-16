import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { isSecureRequest, sessionCookieOptions } from "@/lib/auth/cookies";
import { isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "./client";

type PendingCookie = { name: string; value: string; options: CookieOptions };

/**
 * Supabase client for route handlers. It collects the session cookies (and the no-cache headers that
 * must travel with them) instead of writing through `cookies()`, so they can be put on whichever
 * response the handler returns, redirects included, and so handlers can be tested without Next's
 * request context.
 */
export function createRouteSupabase(request: NextRequest) {
  if (!isSupabaseConfigured) return null;
  const secure = isSecureRequest(request);
  const pending: PendingCookie[] = [];
  let cacheHeaders: Record<string, string> = {};
  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookieOptions: sessionCookieOptions(secure),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          pending.push({ name, value, options });
        }
        cacheHeaders = { ...cacheHeaders, ...headers };
      },
    },
  });
  return {
    supabase,
    secure,
    /** Puts the collected session cookies and cache headers on `response` (last write wins). */
    applyTo<T extends NextResponse>(response: T): T {
      for (const { name, value, options } of pending) response.cookies.set(name, value, options);
      for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
      return response;
    },
  };
}
