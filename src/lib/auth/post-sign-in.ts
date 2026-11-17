import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { destinationBeforeOnboarding } from "./before-onboarding";
import {
  AUTH_HINT_COOKIE,
  hintCookieOptions,
  INTRO_COOKIE,
  INTRO_PLAY_MAX_AGE,
  ONBOARDED_COOKIE,
} from "./cookies";
import { safeNext } from "./safe-next";

/** "play": the account has never seen the intro film; "seen": it has, or that can't be known yet. */
export type IntroState = "play" | "seen";

export type PostSignIn = {
  destination: string;
  /** null when the profile could not be read: the proxy checks again on the next request. */
  onboarded: boolean | null;
  intro: IntroState;
};

type ProfileRow = { onboarded?: boolean | null; intro_completed_at?: string | null } | null;

/**
 * Where a user goes right after a successful sign-in, and what the device should remember. Shared by
 * the OAuth/e-mail-link callback and the password sign-in route, so both flows behave the same.
 */
export async function resolvePostSignIn({
  supabase,
  userId,
  requestedNext,
}: {
  supabase: SupabaseClient;
  userId: string;
  requestedNext: string | null | undefined;
}): Promise<PostSignIn> {
  let introColumn = true;
  let result = await supabase.from("profiles").select("onboarded, intro_completed_at").eq("id", userId).maybeSingle();
  if (result.error && isMissingColumnError(result.error)) {
    // Before the intro migration is applied: never replay the film for everyone.
    introColumn = false;
    result = await supabase.from("profiles").select("onboarded").eq("id", userId).maybeSingle();
  }
  const row = result.error ? null : (result.data as ProfileRow);
  const onboarded = result.error ? null : Boolean(row?.onboarded);
  const intro: IntroState = result.error || !introColumn || row?.intro_completed_at ? "seen" : "play";

  // A password-reset link must land on the reset form even before onboarding. Otherwise an account still
  // in setup goes to onboarding, unless it asked for Help, which it may open (before-onboarding.ts).
  const destination = requestedNext === "/reset-password"
    ? "/reset-password"
    : onboarded === false ? destinationBeforeOnboarding(requestedNext) : safeNext(requestedNext);
  return { destination, onboarded, intro };
}

/** Sets the hint cookies that go with a fresh session. */
export function applySignInCookies(
  response: NextResponse,
  { userId, onboarded, intro, secure }: { userId: string; onboarded: boolean | null; intro: IntroState; secure: boolean },
) {
  response.cookies.set(AUTH_HINT_COOKIE, "1", hintCookieOptions(secure));
  if (onboarded) response.cookies.set(ONBOARDED_COOKIE, userId, hintCookieOptions(secure, { httpOnly: true }));
  else response.cookies.set(ONBOARDED_COOKIE, "", hintCookieOptions(secure, { httpOnly: true, maxAge: 0 }));
  response.cookies.set(INTRO_COOKIE, intro, hintCookieOptions(secure, intro === "play" ? { maxAge: INTRO_PLAY_MAX_AGE } : {}));
}
