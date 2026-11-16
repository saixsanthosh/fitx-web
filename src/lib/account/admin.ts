import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { listUserFiles, MEDIA_BUCKET } from "./export";

/**
 * Server-only account administration (route handlers only; never import this from a client component).
 * It needs SUPABASE_SECRET_KEY, a Supabase secret (or legacy service-role) key that must never be a
 * NEXT_PUBLIC_ variable. Without it, account deletion reports itself as not available.
 */

export function accountDeletionConfigured() {
  return Boolean(SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export function createAdminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const REMOVE_BATCH = 1000;

/** Deletes every file in the user's private media folder (`fitx-user-media/<user id>/…`). */
export async function removeUserFiles(admin: SupabaseClient, userId: string): Promise<{ removed: number; error: unknown }> {
  const listed = await listUserFiles(admin, userId);
  if (listed.error) {
    const message = String((listed.error as { message?: unknown }).message ?? "");
    // No bucket means no files to remove.
    if (/bucket not found/i.test(message)) return { removed: 0, error: null };
    return { removed: 0, error: listed.error };
  }
  let removed = 0;
  const paths = listed.files.map((file) => file.path);
  for (let start = 0; start < paths.length; start += REMOVE_BATCH) {
    const batch = paths.slice(start, start + REMOVE_BATCH);
    const { error } = await admin.storage.from(MEDIA_BUCKET).remove(batch);
    if (error) return { removed, error };
    removed += batch.length;
  }
  return { removed, error: null };
}
