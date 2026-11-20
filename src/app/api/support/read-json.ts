import type { NextRequest } from "next/server";
import { SUPPORT_MAX_BODY_BYTES } from "@/components/support/support-rules";
import { readBodyBytes } from "@/lib/security/body";

/**
 * Reads a small JSON body: `tooLarge` when it is over SUPPORT_MAX_BODY_BYTES (a declared size over the limit is
 * refused before reading, and a body without one is read only up to the limit), else the parsed value or null
 * when it is not JSON.
 */
export async function readSupportJson(request: NextRequest): Promise<{ tooLarge: true } | { tooLarge: false; value: unknown }> {
  const read = await readBodyBytes(request, SUPPORT_MAX_BODY_BYTES);
  if (!read.ok) return read.status === 413 ? { tooLarge: true } : { tooLarge: false, value: null };
  try {
    return { tooLarge: false, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes)) };
  } catch {
    return { tooLarge: false, value: null };
  }
}
