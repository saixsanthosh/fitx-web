/**
 * The workout an /workouts/active address asks for. `?session=` must be a workout session's id (a UUID): anything
 * else, such as a link cut short when it was shared or bookmarked, is a workout that cannot be found, answered
 * without a request (bug 49: it used to reach the database, fail with a 400 and be blamed on the connection).
 * Without `?session=` the page opens the workout in progress, if any. Pure.
 */
import { isUuidString } from "@/lib/security/body";

export type SessionLink = { kind: "none" } | { kind: "invalid" } | { kind: "id"; id: string };

export function sessionLinkFrom(search: string): SessionLink {
  const value = new URLSearchParams(search).get("session");
  if (value === null || value.trim() === "") return { kind: "none" };
  const id = value.trim();
  return isUuidString(id) ? { kind: "id", id: id.toLowerCase() } : { kind: "invalid" };
}

/** What the page says for a session it cannot find: an unknown id and a malformed one alike. */
export const SESSION_NOT_FOUND = "This workout session could not be found. The link may be incomplete, or the workout was removed.";
