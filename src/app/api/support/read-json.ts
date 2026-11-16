import type { NextRequest } from "next/server";
import { SUPPORT_MAX_BODY_BYTES } from "@/components/support/support-rules";

/** Reads a small JSON body; null when it is too large or not JSON. A declared size over the limit is refused before reading. */
export async function readSupportJson(request: NextRequest): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > SUPPORT_MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > SUPPORT_MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
