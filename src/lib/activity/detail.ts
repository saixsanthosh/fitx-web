import { estimateKcal } from "./calories";
import { elevationProfile, type ElevationProfile } from "./elevation";
import type { ActivityEngine, EngineOptions } from "./engine";
import { IMPORT_ENGINE } from "./import/config";
import type { ActivityView } from "./repository";
import type { CardData } from "./share-layouts";
import type { ActivitySource, Fix, LatLng } from "./types";

/** The share image's data for an activity: recorded values only, and whether it ever had a route. */
export function cardDataFor(view: ActivityView, kcal: number | null): CardData {
  return {
    sport: view.sport, title: view.title, startedAt: view.startedAt, distanceM: view.distanceM, movingSeconds: view.movingSeconds,
    avgSpeedMps: view.avgSpeedMps, avgPaceSecondsPerKm: view.avgPaceSecondsPerKm, kcal, elevationGainM: view.elevationGainM, sharePolyline: view.sharePolyline,
    hadRoute: view.pointCount > 0 || Boolean(view.routePolyline), source: view.source,
  };
}

/**
 * Calories worked out later for an activity saved before a body weight was known. Never from no
 * data: without a split that has moving time there is nothing to estimate from (not "0 kcal").
 */
export function lateKcal(view: ActivityView | null, weightKg: number | null): number | null {
  if (!view || view.kcal !== null || weightKg === null) return null;
  if (!view.splits.some((split) => split.movingSeconds > 0)) return null;
  return estimateKcal(view.sport, view.splits, weightKg);
}

/** What an activity page draws from its detailed points: GPX stretches, the route and the elevation profile. */
export type ActivityDetail = { segments: Fix[][]; route: LatLng[][]; profile: ElevationProfile | null };

export function detailFromEngine(engine: ActivityEngine): ActivityDetail {
  return {
    segments: engine.acceptedSegments.filter((segment) => segment.length > 1),
    route: engine.segments.map((segment) => segment.map(({ lat, lng }) => ({ lat, lng }))),
    profile: elevationProfile(engine.acceptedSegments, engine.segments),
  };
}

/** Replays must use the settings the activity was built with: imported files have their own. */
export function engineOptionsFor(source: ActivitySource): EngineOptions {
  return source === "file" ? IMPORT_ENGINE : {};
}
