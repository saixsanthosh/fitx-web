/**
 * Photos of the user's own foods, kept in the private fitx-user-media bucket under the owner's folder
 * ("<uid>/foods/…"), whose storage policies already allow only the owner to read and write it
 * (supabase/migrations/20260924170604_fitx_v1_core_product.sql). Shown through short-lived signed links.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const FOOD_PHOTO_BUCKET = "fitx-user-media";
const MAX_SIDE = 640;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Why a photo wasn't saved, in FITX's words. The photo code below throws it for every failure it can name, and the page
 * shows only its message (photoNotSavedText), never a browser's own (a photo it can't decode, a failed upload).
 */
export class FoodPhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoodPhotoError";
  }
}

/** What to do after an upload or save that failed: check the connection when the request never reached FITX. */
export function photoRetryText(unreached: boolean): string {
  return unreached ? "Check your connection and try again." : "Please try again.";
}

/** What the member reads when their food was saved but its photo wasn't: FITX's reason, or "Please try again.". */
export function photoNotSavedText(cause: unknown): string {
  return `The photo was not saved. ${cause instanceof FoodPhotoError ? cause.message : photoRetryText(false)}`;
}

/** The storage path for a food photo: always inside the user's own folder. */
export function foodPhotoPath(userId: string, foodId: string, stamp = Date.now()): string {
  return `${userId}/foods/${foodId}-${stamp}.webp`;
}

/** Shrinks a photo to at most 640 px on its longer side as WebP (falls back to JPEG), on the device. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new FoodPhotoError("Choose a JPEG, PNG or WebP photo.");
  if (file.size > 25 * 1024 * 1024) throw new FoodPhotoError("That photo is too large. Choose one under 25 MB.");
  // A file this browser can't decode (a HEIC photo outside Safari, a damaged file) is said in FITX's words.
  const bitmap = await createImageBitmap(file).catch(() => { throw new FoodPhotoError("This browser couldn't open that photo. Choose a JPEG, PNG or WebP photo."); });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new FoodPhotoError("This browser can't prepare the photo.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82))
    ?? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new FoodPhotoError("This browser can't prepare the photo.");
  if (blob.size > MAX_UPLOAD_BYTES) throw new FoodPhotoError("That photo is still too large after shrinking.");
  return blob;
}

/**
 * Uploads a food photo already prepared by shrinkPhoto and returns its storage path. It never touches the food or the
 * photo the food had: replaceCustomFoodPhoto (client-data.ts) points the food at the new photo first and removes the old
 * one only after that. Every failure it can name is a FoodPhotoError: an upload that never reached storage
 * (supabase-js's StorageUnknownError wraps the network failure) asks the member to check their connection. Anything
 * else reads "Please try again." (photoNotSavedText).
 */
export async function uploadFoodPhoto(supabase: SupabaseClient, userId: string, foodId: string, blob: Blob, stamp = Date.now()): Promise<string> {
  const path = foodPhotoPath(userId, foodId, stamp);
  const uploaded = await supabase.storage.from(FOOD_PHOTO_BUCKET).upload(path, blob, { contentType: blob.type || "image/webp", upsert: false, cacheControl: "3600" });
  if (uploaded.error) throw new FoodPhotoError(photoRetryText(uploaded.error.name === "StorageUnknownError"));
  return path;
}

/** Signed links (valid for an hour) for the given photo paths, keyed by path. */
export async function signedPhotoUrls(supabase: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const urls = new Map<string, string>();
  if (!unique.length) return urls;
  const { data } = await supabase.storage.from(FOOD_PHOTO_BUCKET).createSignedUrls(unique, 3600);
  for (const item of data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  return urls;
}
