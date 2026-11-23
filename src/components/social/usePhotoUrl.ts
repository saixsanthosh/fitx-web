"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cachedPhotoUrl, photoUrl } from "@/lib/social/media-urls";

/** A signed link for an Explore photo: undefined while asking, null when it cannot be shown. */
export function usePhotoUrl(path: string | null | undefined): string | null | undefined {
  const [url, setUrl] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    const db = createClient();
    if (!db) return;
    let live = true;
    void photoUrl(db, path).then((next) => { if (live) setUrl({ path, url: next }); });
    return () => { live = false; };
  }, [path]);
  if (!path) return null;
  if (url?.path === path) return url.url;
  return cachedPhotoUrl(path);
}
