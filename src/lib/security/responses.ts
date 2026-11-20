import { NextResponse } from "next/server";
import type { BodyFailure } from "./body";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** 429 with Retry-After, never cached. */
export function rateLimitedResponse(retryAfterSeconds: number, body: Record<string, unknown> = { error: "rate_limited" }) {
  const response = NextResponse.json(body, { status: 429, headers: PRIVATE });
  response.headers.set("Retry-After", String(Math.max(1, Math.round(retryAfterSeconds))));
  return response;
}

/** 400, 413 or 415 for a body that was too large, not JSON or not the right type. */
export function bodyErrorResponse(failure: BodyFailure) {
  return NextResponse.json({ error: failure.error }, { status: failure.status, headers: PRIVATE });
}
