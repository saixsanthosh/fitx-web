import { safeNext } from "./safe-next";
import { TIME_LIMIT_MS } from "./time-limit";

/**
 * After a password sign-in (or a sign-up that returns a session right away), asks the server where to
 * go, so it can also write the session and hint cookies itself. Falls back to the dashboard (the proxy
 * still routes new accounts to onboarding) if the server can't be reached or doesn't answer within
 * TIME_LIMIT_MS.finish, so "Signing in…" never stays for ever.
 */
export async function finishPasswordSignIn(next: string | null): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIME_LIMIT_MS.finish);
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "sign-in", next }),
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (response.ok) {
      const body = (await response.json()) as { destination?: unknown };
      if (typeof body.destination === "string") return body.destination === "/reset-password" ? body.destination : safeNext(body.destination);
    }
  } catch {
  } finally {
    clearTimeout(timer);
  }
  return safeNext(next);
}

/**
 * Leaves a sign-in page for the signed-in app. The sign-in page is replaced in the tab's history, so Back goes to the
 * page before it, never to an empty sign-in form shown from the browser's cache while still signed in (bug 40).
 */
export function leaveSignInPage(destination: string): void {
  window.location.replace(destination);
}

/** A sign-in that went through after its form stopped waiting (withTimeLimit's `late`): finish it and go on. */
export function finishLateSignIn(next: string | null): void {
  void finishPasswordSignIn(next).then(leaveSignInPage);
}
