import "server-only";
import { forbidden } from "next/navigation";
import { getAdminSiteOrigin } from "@/lib/site-origin";

/** True when the Origin header is present and is this request's own origin or ADMIN_SITE_URL's. */
export function isSameOrigin(origin: string | null, allowed: ReadonlyArray<string | null | undefined>): boolean {
  if (!origin || origin === "null") return false;
  return allowed.some((candidate) => typeof candidate === "string" && candidate === origin);
}

/**
 * For Route Handlers that change data (Server Actions have Next's own origin check): a request whose
 * Origin header is missing or belongs to another site gets a 403.
 */
export function assertSameOrigin(request: Request): void {
  let own: string | null = null;
  try {
    own = new URL(request.url).origin;
  } catch {
    own = null;
  }
  if (!isSameOrigin(request.headers.get("origin"), [own, getAdminSiteOrigin()])) forbidden();
}
