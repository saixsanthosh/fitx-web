import "server-only";
import { randomBytes } from "node:crypto";
import { logServerError } from "@/lib/log";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { MEDIA_LIMITS, mediaPath, publicObjectUrl, sniffMediaType, typeOfPath, type MediaKind } from "./media-rules";

export type SignedUpload = { ok: true; path: string; uploadUrl: string } | { ok: false; message: string };

function projectUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url && /^https?:\/\//.test(url) ? url.replace(/\/+$/, "") : null;
}

/**
 * A one-time upload address for a new file at a fresh path (it cannot overwrite anything). The browser
 * sends the file straight to Storage; the server never holds it. Callers check the permission first.
 */
export async function createSignedUpload(bucket: string, ownerId: string, kind: MediaKind, type: string): Promise<SignedUpload> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, message: "Server data access is not configured." };
  const path = mediaPath(ownerId, kind, type, randomBytes(12).toString("base64url"));
  if (!path) return { ok: false, message: `Use ${MEDIA_LIMITS[kind].label}.` };
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    logServerError("content.signed_upload", error);
    return { ok: false, message: "Storage did not give an upload address. Check that the bucket exists." };
  }
  return { ok: true, path, uploadUrl: data.signedUrl };
}

export type CheckedUpload = { ok: true; url: string; type: string; size: number } | { ok: false; message: string };

/**
 * Checks an uploaded file before anything points at it: it exists, its size is inside the limit for its
 * kind, and its first bytes really are the type its name says. A file that fails is deleted.
 */
export async function checkUploadedFile(bucket: string, path: string, kind: MediaKind): Promise<CheckedUpload> {
  const supabase = createAdminSupabase();
  const base = projectUrl();
  if (!supabase || !base) return { ok: false, message: "Server data access is not configured." };
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const listed = await supabase.storage.from(bucket).list(folder, { search: name, limit: 5 });
  const entry = listed.data?.find((item) => item.name === name);
  if (listed.error || !entry) return { ok: false, message: "The upload did not arrive. Try again." };
  const size = Number((entry.metadata as Record<string, unknown> | null)?.size);
  const expected = typeOfPath(path);
  let refusal: string | null = null;
  if (!Number.isFinite(size) || size <= 0) refusal = "The file is empty.";
  else if (size > MEDIA_LIMITS[kind].maxBytes) refusal = `The file is over ${Math.round(MEDIA_LIMITS[kind].maxBytes / (1024 * 1024))} MB.`;
  const url = publicObjectUrl(base, bucket, path);
  if (!refusal) {
    try {
      const response = await fetch(url, { headers: { Range: "bytes=0-31" }, cache: "no-store" });
      const bytes = new Uint8Array(await response.arrayBuffer()).slice(0, 32);
      const actual = sniffMediaType(bytes);
      if (!response.ok || !actual || actual !== expected) refusal = `This is not a real ${MEDIA_LIMITS[kind].label.split(",")[0]} file.`;
    } catch (error) {
      logServerError("content.check_upload", error);
      refusal = "The upload could not be checked. Try again.";
    }
  }
  if (refusal) {
    await removeFiles(bucket, [path]);
    return { ok: false, message: refusal };
  }
  return { ok: true, url, type: expected ?? "", size };
}

/** Deletes Admin uploads. Failures are logged, never shown: a stray file costs storage, not safety. */
export async function removeFiles(bucket: string, paths: readonly string[]): Promise<void> {
  const own = paths.filter((path) => path.startsWith("admin/"));
  if (!own.length) return;
  const supabase = createAdminSupabase();
  if (!supabase) return;
  const { error } = await supabase.storage.from(bucket).remove([...own]);
  if (error) logServerError("content.remove_files", error);
}

export function publicUrlFor(bucket: string, path: string): string | null {
  const base = projectUrl();
  return base ? publicObjectUrl(base, bucket, path) : null;
}

export function supabaseProjectUrl(): string | null {
  return projectUrl();
}
