import { safeNext } from "./safe-next";

/**
 * After a password sign-in (or a sign-up that returns a session right away), asks the server where to
 * go, so it can also write the session and hint cookies itself. Falls back to the dashboard (the proxy
 * still routes new accounts to onboarding) if the server can't be reached.
 */
export async function finishPasswordSignIn(next: string | null): Promise<string> {
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "sign-in", next }),
      credentials: "same-origin",
    });
    if (response.ok) {
      const body = (await response.json()) as { destination?: unknown };
      if (typeof body.destination === "string") return body.destination === "/reset-password" ? body.destination : safeNext(body.destination);
    }
  } catch {}
  return safeNext(next);
}
