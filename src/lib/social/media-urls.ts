/**
 * Signed links to Explore photos. The bucket is private; Storage signs a link only for a file the member may read
 * (the bucket's read policy checks the post's or profile's visibility). Links are cached for most of their life and
 * asked for in batches.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SOCIAL_BUCKET } from "./limits";

export const LINK_SECONDS = 60 * 60;
const RENEW_BEFORE_MS = 10 * 60 * 1000;

type Entry = { url: string | null; expires: number };
const cache = new Map<string, Entry>();
const waiting = new Map<string, Array<(url: string | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;
let client: Pick<SupabaseClient, "storage"> | null = null;

export function cachedPhotoUrl(path: string, now = Date.now()): string | null | undefined {
  const entry = cache.get(path);
  if (!entry || entry.expires - RENEW_BEFORE_MS < now) return undefined;
  return entry.url;
}

async function flush() {
  timer = null;
  const db = client;
  const paths = [...waiting.keys()];
  const callbacks = new Map(waiting);
  waiting.clear();
  if (!db || !paths.length) return;
  const settle = (path: string, url: string | null, seconds: number) => {
    cache.set(path, { url, expires: Date.now() + seconds * 1000 });
    for (const done of callbacks.get(path) ?? []) done(url);
  };
  try {
    const { data, error } = await db.storage.from(SOCIAL_BUCKET).createSignedUrls(paths, LINK_SECONDS);
    if (error || !data) throw error ?? new Error("no links");
    const byPath = new Map(data.map((item) => [item.path, item.signedUrl ?? null]));
    for (const path of paths) settle(path, byPath.get(path) ?? null, byPath.get(path) ? LINK_SECONDS : 30);
  } catch {
    for (const path of paths) settle(path, null, 15);
  }
}

/** A signed link for `path`, or null when the member may not read it (or it is gone). */
export function photoUrl(db: Pick<SupabaseClient, "storage">, path: string): Promise<string | null> {
  const cached = cachedPhotoUrl(path);
  if (cached !== undefined) return Promise.resolve(cached);
  client = db;
  return new Promise((resolve) => {
    const list = waiting.get(path) ?? [];
    list.push(resolve);
    waiting.set(path, list);
    timer ??= setTimeout(() => void flush(), 16);
  });
}

/** Forgets cached links, e.g. after a file was replaced or deleted. */
export function forgetPhotoUrls(paths: readonly string[]) {
  for (const path of paths) cache.delete(path);
}
