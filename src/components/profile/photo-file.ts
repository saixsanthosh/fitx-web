/**
 * Profile photos: what a picked file really is, and the order a new photo replaces the old one in.
 *
 * A browser takes a file's declared type from its name, so a text file renamed .png arrives as "image/png", and the
 * storage bucket's allowed types trust that declared type too. So the file's first bytes decide its type (and the
 * type it is stored with), the page also checks that the browser can open it as a picture, and the old photo is only
 * deleted once the new one is stored, opens from storage and is on the profile.
 *
 * No React here, so node tests cover it (tests/profile/profile-photo.test.ts); ProfileView does the browser parts.
 */

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Enough of the file to tell the three formats apart (WebP needs 12 bytes). */
export const PHOTO_HEADER_BYTES = 12;

export type PhotoType = "image/jpeg" | "image/png" | "image/webp";
export const PHOTO_EXTENSIONS: Readonly<Record<PhotoType, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const PHOTO_NOT_AN_IMAGE = "Choose a JPEG, PNG or WebP image.";
export const PHOTO_TOO_BIG = "Choose an image under 5 MB.";
export const PHOTO_UPLOAD_FAILED = "Your photo couldn't be uploaded. Try again.";
export const PHOTO_DID_NOT_OPEN = "Your new photo couldn't be opened after uploading, so nothing changed. Try again, or choose another image.";
export const PHOTO_SAVE_FAILED = "Your photo couldn't be saved. Try again.";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** The image type the file's first bytes show, whatever its name or declared type says; null for anything else. */
export function sniffPhotoType(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return null;
}

export type PhotoCheck = { ok: true; type: PhotoType } | { ok: false; message: string };

/**
 * Whether a picked file can become the profile photo: under 5 MB and, by its content, a JPEG, PNG or WebP.
 * `header` is the file's first PHOTO_HEADER_BYTES bytes (fewer for a shorter file).
 */
export function checkPhotoFile(file: { size: number }, header: Uint8Array): PhotoCheck {
  if (!(file.size > 0)) return { ok: false, message: PHOTO_NOT_AN_IMAGE };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, message: PHOTO_TOO_BIG };
  const type = sniffPhotoType(header);
  return type ? { ok: true, type } : { ok: false, message: PHOTO_NOT_AN_IMAGE };
}

/** A stored photo FITX uploaded for this member (their own folder), as opposed to a Google picture's link. */
export function isOwnPhoto(path: string | null | undefined, userId: string): path is string {
  return typeof path === "string" && path.startsWith(`${userId}/`);
}

/** A new name each time, so no cached copy of the old photo is ever shown. */
export function photoPath(userId: string, type: PhotoType, now: number): string {
  return `${userId}/avatar-${now}.${PHOTO_EXTENSIONS[type]}`;
}

/** What replacing the photo needs from storage and the profile; ProfileView passes Supabase calls. */
export type PhotoSteps = {
  /** Stores the picked file at `path` with `type` (never over an existing object). */
  upload(path: string, type: PhotoType): PromiseLike<{ error: unknown }>;
  /** Whether the stored copy at `path` opens as a picture. */
  opens(path: string): PromiseLike<boolean>;
  /** Points the profile at `path`. */
  save(path: string): PromiseLike<{ error: unknown }>;
  /** Deletes stored objects. */
  remove(paths: string[]): PromiseLike<unknown>;
};

export type ReplaceOutcome = { ok: true; path: string } | { ok: false; step: "upload" | "open" | "save"; message: string };

async function quietly(work: () => PromiseLike<unknown>): Promise<void> {
  try {
    await work();
  } catch {
    // Clean-up only: a leftover object in the member's own folder is harmless, the outcome is what matters.
  }
}

/**
 * Replaces the profile photo: upload, check the stored copy opens, save it on the profile, and only then delete the
 * previous upload. When any step fails the new upload is removed and the profile and the old photo stay as they were.
 */
export async function replacePhoto(
  steps: PhotoSteps,
  { userId, type, previous, now }: { userId: string; type: PhotoType; previous: string | null; now: number },
): Promise<ReplaceOutcome> {
  const path = photoPath(userId, type, now);
  let uploaded: { error: unknown };
  try {
    uploaded = await steps.upload(path, type);
  } catch (error) {
    uploaded = { error };
  }
  if (uploaded.error) return { ok: false, step: "upload", message: PHOTO_UPLOAD_FAILED };

  let opens = false;
  try {
    opens = await steps.opens(path);
  } catch {
    opens = false;
  }
  if (!opens) {
    await quietly(() => steps.remove([path]));
    return { ok: false, step: "open", message: PHOTO_DID_NOT_OPEN };
  }

  let saved: { error: unknown };
  try {
    saved = await steps.save(path);
  } catch (error) {
    saved = { error };
  }
  if (saved.error) {
    await quietly(() => steps.remove([path]));
    return { ok: false, step: "save", message: PHOTO_SAVE_FAILED };
  }

  if (isOwnPhoto(previous, userId) && previous !== path) await quietly(() => steps.remove([previous]));
  return { ok: true, path };
}
