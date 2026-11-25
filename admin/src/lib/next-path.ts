// Where sign-in sends an operator afterwards (?next=): the console page they opened, as they opened it (a member,
// a help request, a report, the Users filters), so a teammate's link still works after a session ends. Only a page
// of this console: never another site, never a file download, never the sign-in page itself. Imports only roles.ts
// (no imports of its own), so tests can load it.

import { PAGE_PERMISSIONS } from "@/lib/roles";

/** The request header the proxy fills with the page being opened, for requireAdmin's redirect to /login. */
export const ADMIN_PATH_HEADER = "x-fitx-admin-path";

const BASE = "https://admin.invalid";
const MAX_LENGTH = 512;
/** Every console section, and /account (needs only a session). */
const ROOTS = [...Object.keys(PAGE_PERMISSIONS), "/account"];
/** Route Handlers that answer with a file, not a page. */
const FILE_ROUTES = new Set(["/audit/export", "/reports/export"]);
/** A path segment: the IDs and codes Admin's own links use (UUIDs, exercise and food IDs, plan codes). */
const SEGMENT = /^[A-Za-z0-9_-]{1,120}$/;
/** What belonged to the visit that ended (a result notice) and Next.js's own fetch marker. */
const DROPPED = new Set(["notice", "state", "message", "count", "_rsc"]);

/**
 * The path and query of a console page of this site, or null for anything else: another origin ("//x", "/\x",
 * "https://…"), a path outside the console, a file route, an odd segment, or anything over 512 characters.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_LENGTH || !value.startsWith("/") || value.startsWith("//")) return null;
  // Backslashes, spaces and control characters never appear in Admin's own links (browsers read "/\" as "//").
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  // "/users/" is "/users" (Next.js redirects it so).
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
  if (FILE_ROUTES.has(path)) return null;
  if (!ROOTS.some((root) => path === root || path.startsWith(`${root}/`))) return null;
  if (!path.slice(1).split("/").every((segment) => SEGMENT.test(segment))) return null;
  for (const key of [...url.searchParams.keys()]) {
    if (DROPPED.has(key)) url.searchParams.delete(key);
  }
  const query = url.searchParams.toString();
  return query ? `${path}?${query}` : path;
}

/** The sign-in address for a page that needs a session: /login, with ?next= when the page is a console page. */
export function signInPath(page: unknown): string {
  const next = safeNextPath(page);
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
