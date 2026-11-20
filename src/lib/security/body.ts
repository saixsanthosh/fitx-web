/**
 * Request bodies read with a hard size limit. A declared Content-Length over the limit is refused before reading,
 * and a body sent without one (chunked) is read only until it passes the limit, so no request can make a route
 * buffer more than `maxBytes`. No imports: route handlers and tests load it directly.
 */

export type BodyFailure = { ok: false; status: 400 | 413 | 415; error: "invalid_body" | "payload_too_large" | "unsupported_media_type" };
export type BytesResult = { ok: true; bytes: Uint8Array } | BodyFailure;
export type JsonResult = { ok: true; value: Record<string, unknown> } | BodyFailure;

const tooLarge: BodyFailure = { ok: false, status: 413, error: "payload_too_large" };
const invalid: BodyFailure = { ok: false, status: 400, error: "invalid_body" };

/** The raw body, at most `maxBytes`. An empty or missing body is zero bytes. */
export async function readBodyBytes(request: Request, maxBytes: number): Promise<BytesResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null && declared.trim() !== "") {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) return invalid;
    if (length > maxBytes) return tooLarge;
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return tooLarge;
      }
      chunks.push(value);
    }
  } catch {
    return invalid;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * A JSON object body of at most `maxBytes`. Arrays, primitives and malformed JSON are 400. With
 * `requireJsonType`, a Content-Type other than application/json is 415 (a cross-site form cannot send JSON).
 * With `allowEmpty`, a missing body is an empty object.
 */
export async function readJsonObject(
  request: Request,
  maxBytes: number,
  { requireJsonType = false, allowEmpty = false }: { requireJsonType?: boolean; allowEmpty?: boolean } = {},
): Promise<JsonResult> {
  if (requireJsonType && !/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
    return { ok: false, status: 415, error: "unsupported_media_type" };
  }
  const read = await readBodyBytes(request, maxBytes);
  if (!read.ok) return read;
  if (read.bytes.byteLength === 0) return allowEmpty ? { ok: true, value: {} } : invalid;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes));
  } catch {
    return invalid;
  }
  return value && typeof value === "object" && !Array.isArray(value) ? { ok: true, value: value as Record<string, unknown> } : invalid;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** A string field of at most `max` characters, else null. */
export function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

/** readJsonObject for callers that answer every bad body the same way: the object, or null (JSON content type required). */
export async function readJsonObjectOrNull(request: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const read = await readJsonObject(request, maxBytes, { requireJsonType: true });
  return read.ok ? read.value : null;
}
