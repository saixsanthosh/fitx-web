import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/** JSON that no browser or CDN may cache: every billing answer is per account or per event. */
export function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** The name to prefill in Checkout, from the Google or e-mail sign-up metadata. */
export function displayName(user: Pick<User, "user_metadata">): string | null {
  const meta = user.user_metadata ?? {};
  const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
  return name?.trim() ? name.trim().slice(0, 80) : null;
}

/** Constant-time check of an "Authorization: Bearer <secret>" header. */
export function bearerMatches(header: string | null, secret: string | null): boolean {
  if (!header || !secret) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.trim()), digest(`Bearer ${secret}`));
}
