import "server-only";
import { createClient } from "@supabase/supabase-js";

function adminServerKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** True when the server-only Supabase key is set. The value itself is never returned. */
export function hasAdminServerKey() {
  return Boolean(adminServerKey());
}

export function createAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = adminServerKey();
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
