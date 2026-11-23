"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SOCIAL_BUCKET } from "@/lib/social/limits";
import type { PreparedVideo } from "./VideoPicker";

type Storage = Pick<SupabaseClient, "storage">["storage"];

/** The bucket's refusals, in the member's words. Its policy refuses past the daily video limit, the caps or the switch. */
export function uploadProblem(message: string, what: "video" | "photo"): string {
  if (/limit|exceed|row-level|security policy|payload too large/i.test(message)) {
    return what === "video" ? "Video uploads are full for today, or Explore is out of space. Try again tomorrow." : "You have reached today’s photo limit. Try again tomorrow.";
  }
  return what === "video" ? "The video did not upload. Try again." : "A photo did not upload. Try again.";
}

/**
 * Uploads a prepared clip to `videoPath` (…/<n>.mp4) and its poster to `posterPath` (…/<n>p.webp). Returns the paths
 * uploaded so far when it fails (the caller removes them), as `{ uploaded, error }`.
 */
export async function uploadVideo(storage: Storage, video: PreparedVideo, videoPath: string, posterPath: string, onProgress?: (share: number) => void) {
  const uploaded: string[] = [];
  const bucket = storage.from(SOCIAL_BUCKET);
  const first = await bucket.upload(videoPath, video.blob, { contentType: "video/mp4", upsert: false, cacheControl: "31536000" });
  if (first.error) return { uploaded, error: uploadProblem(first.error.message, "video") };
  uploaded.push(videoPath);
  onProgress?.(0.6);
  const second = await bucket.upload(posterPath, video.poster.blob, { contentType: video.poster.type, upsert: false, cacheControl: "31536000" });
  if (second.error) return { uploaded, error: uploadProblem(second.error.message, "video") };
  uploaded.push(posterPath);
  onProgress?.(0.8);
  return { uploaded, error: null };
}
