import type { NextRequest } from "next/server";
import { SUPPORT_MAX_BODY_BYTES } from "@/components/support/support-rules";

/** Reads a small JSON body; null when it is too large or not JSON. */
export async function readSupportJson(request: NextRequest): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > SUPPORT_MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
