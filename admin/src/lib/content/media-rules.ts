// What Admin accepts as an exercise demonstration or a food photo, and where it is stored. No imports.
// The buckets' own limits (migration 20261121100036) back these up on the Storage side.

export const EXERCISE_MEDIA_BUCKET = "exercise-media";
export const FOOD_MEDIA_BUCKET = "food-media";

export type MediaKind = "still" | "video_loop" | "food_photo";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/webm"] as const;

const MB = 1024 * 1024;

export const MEDIA_LIMITS: Record<MediaKind, { types: readonly string[]; maxBytes: number; label: string }> = {
  still: { types: IMAGE_TYPES, maxBytes: 5 * MB, label: "JPEG, PNG, WebP or AVIF, up to 5 MB" },
  video_loop: { types: VIDEO_TYPES, maxBytes: 50 * MB, label: "MP4 or WebM, up to 50 MB, no sound needed" },
  food_photo: { types: IMAGE_TYPES, maxBytes: 5 * MB, label: "JPEG, PNG, WebP or AVIF, up to 5 MB" },
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function extensionFor(type: string): string | null {
  return Object.hasOwn(EXTENSIONS, type) ? EXTENSIONS[type] : null;
}

export function isMediaKind(value: unknown): value is MediaKind {
  return value === "still" || value === "video_loop" || value === "food_photo";
}

/** Why a file cannot be used, or null when its declared type and size fit. */
export function checkDeclaredFile(kind: MediaKind, type: string, size: number): string | null {
  const limit = MEDIA_LIMITS[kind];
  if (!limit.types.includes(type)) return `Use ${limit.label}.`;
  if (!Number.isSafeInteger(size) || size <= 0) return "The file is empty.";
  if (size > limit.maxBytes) return `The file is over ${Math.round(limit.maxBytes / MB)} MB.`;
  return null;
}

const FOLDER_ID = /^[A-Za-z0-9_-]{1,120}$/;
const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

/** "admin/<owner id>/<still|video|photo>-<token>.<ext>": inside the bucket, one folder per exercise or food. */
export function mediaPath(ownerId: string, kind: MediaKind, type: string, token: string): string | null {
  const extension = extensionFor(type);
  if (!FOLDER_ID.test(ownerId) || !TOKEN.test(token) || !extension || !MEDIA_LIMITS[kind].types.includes(type)) return null;
  const prefix = kind === "still" ? "still" : kind === "video_loop" ? "video" : "photo";
  return `admin/${ownerId}/${prefix}-${token}.${extension}`;
}

/** True for a path mediaPath made for this owner and kind. */
export function isMediaPathFor(path: unknown, ownerId: string, kind: MediaKind): path is string {
  if (typeof path !== "string" || !FOLDER_ID.test(ownerId)) return false;
  const prefix = kind === "still" ? "still" : kind === "video_loop" ? "video" : "photo";
  const types = MEDIA_LIMITS[kind].types.map((type) => extensionFor(type)).join("|");
  return new RegExp(`^admin/${ownerId}/${prefix}-[A-Za-z0-9_-]{8,64}\\.(${types})$`).test(path);
}

export function typeOfPath(path: string): string | null {
  const extension = path.split(".").pop() ?? "";
  return Object.entries(EXTENSIONS).find(([, value]) => value === extension)?.[0] ?? null;
}

/**
 * The real type of a file from its first bytes (at least 16), so a page or script renamed .jpg is refused:
 * JPEG FF D8 FF; PNG 89 50 4E 47 0D 0A 1A 0A; WebP "RIFF....WEBP"; AVIF and MP4 an ISO "ftyp" box
 * (brand avif/avis is AVIF, anything else MP4); WebM the EBML header 1A 45 DF A3.
 */
export function sniffMediaType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    return brand === "avif" || brand === "avis" ? "image/avif" : "video/mp4";
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return null;
}

/** The public URL of an object in one of the Admin media buckets. */
export function publicObjectUrl(supabaseUrl: string, bucket: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The object path of a public URL in a bucket on this project, or null for any other URL. */
export function objectPathFromUrl(url: string, supabaseUrl: string, bucket: string): string | null {
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/`;
  if (!url.startsWith(prefix)) return null;
  const path = decodeURIComponent(url.slice(prefix.length));
  return /^admin\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(path) ? path : null;
}
