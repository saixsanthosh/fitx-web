import { createBrowserClient } from "@supabase/ssr";
import { sessionCookieOptions } from "@/lib/auth/cookies";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** True when real Supabase keys are present. Without them account features show a setup message. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Browser Supabase client (singleton). Returns null when Supabase is not configured. */
let browserClient: ReturnType<typeof createBrowserClient> | null = null;
export function createClient() {
  if (!isSupabaseConfigured) return null;
  if (!browserClient) {
    const secure = typeof window !== "undefined" && window.location.protocol === "https:";
    browserClient = createBrowserClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { cookieOptions: sessionCookieOptions(secure) });
  }
  return browserClient;
}
