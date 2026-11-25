import { SPORT_INFO, sportFromSlug } from "./config";
import type { Sport } from "./types";

/*
 * /activity/<segment>: a sport's page (hike, trail-run, mountain-bike…), or one activity by its id (a saved
 * activity's UUID, or "local-" + the device id of one not uploaded yet). Ids are UUIDs, so the two never collide.
 * Anything else is not a page, and keeps the not-found page's own title.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ACTIVITY_ID = new RegExp(`^(?:local-)?${UUID}$`, "i");

export type ActivityRoute = { kind: "sport"; sport: Sport } | { kind: "activity"; id: string };

export function activityRoute(segment: string): ActivityRoute | null {
  const sport = sportFromSlug(segment);
  if (sport) return { kind: "sport", sport };
  return ACTIVITY_ID.test(segment) ? { kind: "activity", id: segment.toLowerCase() } : null;
}

/** The page title: the sport's name ("Hikes"), or "Activity" for one activity. */
export function activityRouteTitle(route: ActivityRoute): string {
  return route.kind === "sport" ? SPORT_INFO[route.sport].plural : "Activity";
}
