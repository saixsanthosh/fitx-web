/**
 * Profile photos: what a picked file really is, and the order a new photo replaces the old one in.
 *
 * A browser takes a file's declared type from its name, so a text file renamed .png arrives as "image/png", and the
 * storage bucket's allowed types trust that declared type too. So the file's first bytes decide its type (and the
 * type it is stored with), the page also checks that the browser can open it as a picture, and the old photo is only
 * deleted once the new one is stored, opens from storage and is on the profile.
 *
 * Every step that waits on the network has a time limit (fix round 3d, tests/profile/photo-time-limit.test.ts), so
 * "Working…" never stays up for good: the upload's grows with the file, the profile's save is cancelled at its limit,
 * and clean-ups are waited for only so long.
 *
 * No React here, so node tests cover it (tests/profile/profile-photo.test.ts); ProfileView does the browser parts.
 */
import { isTimeLimit, withTimeLimit } from "@/lib/auth/time-limit";
import { SAVE_TIMED_OUT, saveWithinLimit } from "@/lib/onboarding/time-limit";
import { PROFILE_TIME_LIMIT_MS } from "./profile-save";

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
/** The upload ran out of time; one that still lands is removed again, so nothing changes. */
export const PHOTO_UPLOAD_TIMED_OUT = "Uploading your photo is taking too long, so we stopped waiting. Nothing changed. Check your connection and try again.";
/** The profile's save ran out of time. It may still have gone through, so this doesn't say nothing changed. */
export const PHOTO_SAVE_TIMED_OUT = "Saving your new photo is taking too long, so we stopped waiting. Check your connection and try again.";
/** Download photo: storage's link didn't come in time. */
export const PHOTO_LINK_TIMED_OUT = "Getting your photo is taking too long, so we stopped waiting. Check your connection and try again.";

/**
 * The slowest upload a photo is still given time for: 256 kbit/s. A connection that slow, or slower, is very likely
 * stalled rather than busy.
 */
export const SLOWEST_UPLOAD_BYTES_PER_SECOND = 32_000;

/**
 * How long uploading `bytes` may take before Profile stops waiting: Profile's save limit, plus what the file needs at
 * the slowest upload speed (about 50 s for 1 MB, about three minutes for 5 MB), so a slow connection that is still
 * sending isn't cut off the way a fixed limit would (review home-2 was that mistake for the download).
 */
export function uploadLimitMs(bytes: number): number {
  return PROFILE_TIME_LIMIT_MS.save + Math.ceil((Math.max(0, bytes) / SLOWEST_UPLOAD_BYTES_PER_SECOND) * 1000);
}

/** What a storage link request gives (createSignedUrl). */
type SignedUrlAnswer = { data: { signedUrl: string } | null; error: unknown };

/**
 * A signed link from storage within Profile's limit: its URL, null when storage refused or broke off, or "timed_out".
 * Storage's client can't cancel the request; a link that comes later is never used.
 */
export async function signedUrlWithin(request: PromiseLike<SignedUrlAnswer>, ms: number = PROFILE_TIME_LIMIT_MS.save): Promise<string | null | "timed_out"> {
  try {
    const { data, error } = await withTimeLimit(request, ms);
    return error ? null : data?.signedUrl ?? null;
  } catch (problem) {
    return isTimeLimit(problem) ? "timed_out" : null;
  }
}

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

/**
 * How long the stored copy may go without a single new byte arriving (or, at first, without an answer) before the
 * check gives up on it.
 */
export const STALL_LIMIT_MS = 15_000;

/** setTimeout and clearTimeout, which tests replace. */
export type Timers = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
const SYSTEM_TIMERS: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Downloads the stored copy of a new photo to the end (review home-2). A photo of up to 5 MB on a slow connection
 * can take a minute or more and still be fine, so there is no limit on the whole download: it gives up only on an
 * error, a refused answer, more than `maxBytes`, or `stallMs` with nothing new arriving. Returns the bytes, typed as
 * the server sent them, or null. `start` makes the request with the signal it is given (ProfileView uses fetch).
 */
export async function downloadUnlessStalled(
  start: (signal: AbortSignal) => PromiseLike<Response>,
  { stallMs = STALL_LIMIT_MS, maxBytes = PHOTO_MAX_BYTES, timers = SYSTEM_TIMERS }: { stallMs?: number; maxBytes?: number; timers?: Timers } = {},
): Promise<Blob | null> {
  const controller = new AbortController();
  // Rejects when the stall timer fires, so a request or a read that never settles can't hold the check.
  const stalled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("stalled")), { once: true });
  });
  stalled.catch(() => undefined);
  let timer: unknown = null;
  const restartTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => controller.abort(), stallMs);
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let complete = false;
  try {
    restartTimer();
    const response = await Promise.race([start(controller.signal), stalled]);
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    // A browser without readable response bodies: the whole file is the one step the timer watches.
    if (!response.body) {
      const blob = await Promise.race([response.blob(), stalled]);
      complete = blob.size <= maxBytes;
      return complete ? blob : null;
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      restartTimer();
      const { done, value } = await Promise.race([reader.read(), stalled]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) return null;
      chunks.push(value);
    }
    complete = true;
    return new Blob(chunks as BlobPart[], { type });
  } catch {
    return null;
  } finally {
    if (timer !== null) timers.clear(timer);
    if (!complete) {
      controller.abort();
      reader?.cancel().catch(() => undefined);
    }
  }
}

/** A new name each time, so no cached copy of the old photo is ever shown. */
export function photoPath(userId: string, type: PhotoType, now: number): string {
  return `${userId}/avatar-${now}.${PHOTO_EXTENSIONS[type]}`;
}

/** What replacing the photo needs from storage and the profile; ProfileView passes Supabase calls. */
export type PhotoSteps = {
  /** Stores the picked file at `path` with `type` (never over an existing object). */
  upload(path: string, type: PhotoType): PromiseLike<{ error: unknown }>;
  /** Whether the stored copy at `path` opens as a picture. Its own limits apply (signedUrlWithin, downloadUnlessStalled). */
  opens(path: string): PromiseLike<boolean>;
  /** Points the profile at `path`, with every request built from `signal`, which the save's limit aborts. */
  save(path: string, signal: AbortSignal): PromiseLike<{ error: unknown }>;
  /** Deletes stored objects. */
  remove(paths: string[]): PromiseLike<unknown>;
};

export type ReplaceOutcome = { ok: true; path: string } | { ok: false; step: "upload" | "open" | "save"; message: string };

/** How long each step is waited for, in milliseconds. The check that the stored copy opens has its own limits. */
export type PhotoLimits = { upload: number; save: number; cleanUp: number };

const DEFAULT_LIMITS: PhotoLimits = { upload: uploadLimitMs(PHOTO_MAX_BYTES), save: PROFILE_TIME_LIMIT_MS.save, cleanUp: PROFILE_TIME_LIMIT_MS.save };

async function quietly(work: () => PromiseLike<unknown>, ms: number): Promise<void> {
  try {
    await withTimeLimit(work(), ms);
  } catch {
    // Clean-up only: a leftover object in the member's own folder is harmless, the outcome is what matters. A removal
    // that doesn't answer in time is left to finish on its own.
  }
}

/**
 * Replaces the profile photo: upload, check the stored copy opens, save it on the profile, and only then delete the
 * previous upload. When any step fails the new upload is removed and the profile and the old photo stay as they were.
 * A step that runs out of time stops the replacement (`limits`; ProfileView gives the upload its file's own limit).
 */
export async function replacePhoto(
  steps: PhotoSteps,
  { userId, type, previous, now, limits = {} }: { userId: string; type: PhotoType; previous: string | null; now: number; limits?: Partial<PhotoLimits> },
): Promise<ReplaceOutcome> {
  const { upload: uploadMs, save: saveMs, cleanUp: cleanUpMs } = { ...DEFAULT_LIMITS, ...limits };
  const path = photoPath(userId, type, now);
  const removeNew = () => quietly(() => steps.remove([path]), cleanUpMs);
  let uploaded: { error: unknown };
  try {
    // Storage's client can't cancel an upload. Past its limit Profile stops waiting, and an upload that still lands
    // afterwards is removed again, so nothing changes and no copy is left behind while the page stays open.
    uploaded = await withTimeLimit(steps.upload(path, type), uploadMs, (late) => {
      if (!late.error) void removeNew();
    });
  } catch (error) {
    if (isTimeLimit(error)) return { ok: false, step: "upload", message: PHOTO_UPLOAD_TIMED_OUT };
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
    await removeNew();
    return { ok: false, step: "open", message: PHOTO_DID_NOT_OPEN };
  }

  // The profile's update carries the save's signal and is cancelled at the limit, as Profile's other saves are.
  const problem = await saveWithinLimit(async (signal) => ((await steps.save(path, signal)).error ? PHOTO_SAVE_FAILED : null), { ms: saveMs });
  if (problem === SAVE_TIMED_OUT.page) {
    // The update may still have reached the database, so the new upload stays (removing it could leave the profile
    // pointing at nothing), and so does the old photo.
    return { ok: false, step: "save", message: PHOTO_SAVE_TIMED_OUT };
  }
  if (problem) {
    await removeNew();
    return { ok: false, step: "save", message: PHOTO_SAVE_FAILED };
  }

  if (isOwnPhoto(previous, userId) && previous !== path) await quietly(() => steps.remove([previous]), cleanUpMs);
  return { ok: true, path };
}
