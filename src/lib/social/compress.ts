/**
 * Photo compression in the browser, before anything is uploaded: the long edge is scaled to at most 1,600 px and the
 * photo re-encoded as WebP (JPEG where the browser cannot encode WebP, as older Safari). Re-encoding also drops the
 * file's metadata (camera, time and GPS location), so a photo never carries where it was taken.
 */
import { SOCIAL_LIMITS } from "./limits";
import type { PhotoType } from "./paths";

export type CompressedPhoto = { blob: Blob; type: PhotoType; width: number; height: number };

/** The size to draw at: the long edge at most `longEdge`, never enlarged. */
export function targetSize(width: number, height: number, longEdge: number = SOCIAL_LIMITS.photoLongEdge): { width: number; height: number } {
  if (!(width > 0 && height > 0)) throw new Error("This photo has no size.");
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Qualities to try, best first, until the file fits the bucket's limit. */
export const QUALITY_STEPS = [0.82, 0.74, 0.64, 0.52] as const;

export const ACCEPTED_SOURCE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif", "image/gif"];

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Decodes, scales and re-encodes one photo. Throws an Error with a member-facing message when it cannot. */
export async function compressPhoto(file: File, longEdge: number = SOCIAL_LIMITS.photoLongEdge): Promise<CompressedPhoto> {
  if (file.size > SOCIAL_LIMITS.sourceBytes) throw new Error("That photo is over 40 MB.");
  if (file.type && !file.type.startsWith("image/")) throw new Error("Choose a photo.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older Safari refuses the options object; it applies the photo's orientation by itself.
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error("This photo could not be opened. Try a JPEG or PNG.");
    }
  }
  try {
    const size = targetSize(bitmap.width, bitmap.height, longEdge);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare photos.");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    for (const type of ["image/webp", "image/jpeg"] as const) {
      for (const quality of QUALITY_STEPS) {
        const blob = await toBlob(canvas, type, quality);
        // A browser that cannot encode WebP hands back a PNG instead: try JPEG.
        if (!blob || blob.type !== type) break;
        if (blob.size <= SOCIAL_LIMITS.fileBytes) return { blob, type, width: size.width, height: size.height };
      }
    }
    throw new Error("This photo could not be made small enough.");
  } finally {
    bitmap.close();
  }
}
