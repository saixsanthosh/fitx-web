/**
 * Explore photos of a member account, removed when Admin deletes the account. A copy of the FITX app's
 * removeSocialMediaFiles (src/lib/account/deletion.ts), since Admin cannot import from the app: keep the two in step.
 */

/** The private bucket of Explore photos (supabase/migrations/20261123100060_fitx_social_v1.sql). */
export const SOCIAL_MEDIA_BUCKET = "social-media";

type StorageEntry = { name: string; id?: string | null };
type StorageBucketLike = {
  list(path: string, options: { limit: number; offset: number }): PromiseLike<{ data: StorageEntry[] | null; error: unknown }>;
  remove(paths: string[]): PromiseLike<{ error: unknown }>;
};
/** The part of a Supabase client this needs (Admin's server-key client). */
export type StorageClientLike = { storage: { from(bucket: string): StorageBucketLike } };

const SOCIAL_PAGE = 1000;

async function listAll(bucket: StorageBucketLike, prefix: string): Promise<{ entries: StorageEntry[]; error: unknown }> {
  const entries: StorageEntry[] = [];
  for (let offset = 0; ; offset += SOCIAL_PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: SOCIAL_PAGE, offset });
    if (error) return { entries, error };
    entries.push(...(data ?? []));
    if (!data || data.length < SOCIAL_PAGE) return { entries, error: null };
  }
}

/**
 * Deletes every Explore photo of an account: `social-media/<user id>/<post id or "profile">/<file>`. Storage lists one
 * folder level at a time, so it lists the account's folders, then each folder's files. A missing bucket means there
 * is nothing to remove. Run it before the login is deleted (the database rows go with the login).
 */
export async function removeSocialMediaFiles(admin: StorageClientLike, userId: string): Promise<{ removed: number; error: unknown }> {
  const bucket = admin.storage.from(SOCIAL_MEDIA_BUCKET);
  const top = await listAll(bucket, userId);
  if (top.error) {
    const message = String((top.error as { message?: unknown }).message ?? "");
    return /bucket not found/i.test(message) ? { removed: 0, error: null } : { removed: 0, error: top.error };
  }
  const paths: string[] = [];
  for (const entry of top.entries) {
    if (entry.id) {
      paths.push(`${userId}/${entry.name}`);
      continue;
    }
    const inner = await listAll(bucket, `${userId}/${entry.name}`);
    if (inner.error) return { removed: 0, error: inner.error };
    for (const file of inner.entries) if (file.id) paths.push(`${userId}/${entry.name}/${file.name}`);
  }
  let removed = 0;
  for (let start = 0; start < paths.length; start += SOCIAL_PAGE) {
    const batch = paths.slice(start, start + SOCIAL_PAGE);
    const { error } = await bucket.remove(batch);
    if (error) return { removed, error };
    removed += batch.length;
  }
  return { removed, error: null };
}
