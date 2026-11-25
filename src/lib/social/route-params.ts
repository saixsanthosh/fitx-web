import { isUuid } from "./paths";

/**
 * Explore's dynamic addresses, read in one place for both a page and its title (bug 78's rule): a malformed address is
 * not found, and its title is "Page not found", never the title of the page it would have been. Null when the
 * segment cannot be what it names.
 */

/** /explore/u/<username> and /explore/stories/<username>: "@Ben.Okafor" and "%40ben.okafor" read as "ben.okafor". */
export function routeUsername(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  const name = decoded.replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(name) ? name : null;
}

/** /explore/p/<id>, /explore/challenges/<id> and /explore/messages/<id>. */
export function routeId(segment: string): string | null {
  const id = segment.toLowerCase();
  return isUuid(id) ? id : null;
}

/** /explore/c/<slug>. */
export function routeSlug(segment: string): string | null {
  const value = segment.toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(value) ? value : null;
}
