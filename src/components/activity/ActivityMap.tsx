"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import { LocateFixed } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { destination } from "@/lib/activity/geo";
import { isDarkTheme, mapStyleUrl, themeToken, usesDefaultDarkStyle, watchTheme } from "@/lib/activity/map-style";
import type { LatLng } from "@/lib/activity/types";
import { RouteSvg } from "./RouteSvg";
import styles from "./ActivityMap.module.css";

// MapLibre loads its web worker from a URL. The bundler emits the package's worker file as a
// static asset for this reference, so the worker is served by FITX itself (no third-party CDN).
let workerConfigured = false;
function configureWorker() {
  if (workerConfigured) return;
  workerConfigured = true;
  setWorkerUrl(new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
}

export type ActivityMapProps = {
  /** The route, one array per continuous stretch (never joined). */
  segments: readonly (readonly LatLng[])[];
  /** Changes when `segments` changes (the arrays may be mutated in place while recording). */
  version?: number;
  /** The live position and its accuracy, while recording. */
  current?: { lat: number; lng: number; acc: number } | null;
  /** Keep the live position in view (stops when the person pans the map, until re-centred). */
  follow?: boolean;
  /** Show start and finish dots. */
  showEnds?: boolean;
  className?: string;
  label: string;
};

type RouteFeatures = GeoJSON.FeatureCollection<GeoJSON.LineString>;
const emptyCollection = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

function routeData(segments: readonly (readonly LatLng[])[]): RouteFeatures {
  return {
    type: "FeatureCollection",
    features: segments.filter((s) => s.length > 1).map((segment) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: segment.map((p) => [p.lng, p.lat]) } })),
  };
}

function endsData(segments: readonly (readonly LatLng[])[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const filled = segments.filter((s) => s.length > 0);
  if (!filled.length) return { type: "FeatureCollection", features: [] };
  const first = filled[0][0];
  const lastSegment = filled[filled.length - 1];
  const last = lastSegment[lastSegment.length - 1];
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { kind: "start" }, geometry: { type: "Point", coordinates: [first.lng, first.lat] } },
      { type: "Feature", properties: { kind: "finish" }, geometry: { type: "Point", coordinates: [last.lng, last.lat] } },
    ],
  };
}

function accuracyCircle(center: LatLng, radius: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring = Array.from({ length: 49 }, (_, i) => {
    const p = destination(center, (i * 360) / 48, Math.max(1, radius));
    return [p.lng, p.lat];
  });
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

function boundsOf(segments: readonly (readonly LatLng[])[]): [[number, number], [number, number]] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const segment of segments) for (const p of segment) {
    w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat);
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}

/**
 * OpenFreeMap's dark style draws roads almost black on black. In FITX's dark theme the base map
 * takes the FITX dark surfaces instead, so streets stay readable under the route.
 */
function applyDarkPalette(map: MapLibreMap) {
  const bg = themeToken("--fitx-bg");
  const surface = themeToken("--fitx-surface");
  const variant = themeToken("--fitx-surface-variant");
  const track = themeToken("--fitx-track");
  if (!bg || !surface || !variant || !track) return;
  type PaintProperty = Parameters<MapLibreMap["setPaintProperty"]>[1];
  const set = (id: string, property: PaintProperty, value: string) => {
    try { map.setPaintProperty(id, property, value); } catch { /* A layer this style doesn't have. */ }
  };
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    if (layer.type === "background") set(id, "background-color", bg);
    else if (layer.type === "fill" && /water/.test(id)) set(id, "fill-color", variant);
    else if (layer.type === "fill" && /park|wood|grass|landcover|landuse/.test(id)) set(id, "fill-color", surface);
    else if (layer.type === "fill" && /building/.test(id)) set(id, "fill-color", surface);
    else if (layer.type === "line" && /waterway/.test(id)) set(id, "line-color", variant);
    else if (layer.type === "line" && /(highway|road|street|path|track)/.test(id) && !/casing|dash|rail/.test(id)) {
      set(id, "line-color", /major|motorway|trunk|primary|secondary/.test(id) ? track : variant);
    }
  }
}

/** Adds FITX's route, end and position layers to the current style (again after a style swap). */
function addLayers(map: MapLibreMap) {
  const primary = themeToken("--fitx-primary") || "currentColor";
  const surface = themeToken("--fitx-card-bg");
  const text = themeToken("--fitx-text");
  if (!map.getSource("fitx-route")) map.addSource("fitx-route", { type: "geojson", data: emptyCollection() });
  if (!map.getSource("fitx-ends")) map.addSource("fitx-ends", { type: "geojson", data: emptyCollection() });
  if (!map.getSource("fitx-accuracy")) map.addSource("fitx-accuracy", { type: "geojson", data: emptyCollection() });
  if (!map.getSource("fitx-position")) map.addSource("fitx-position", { type: "geojson", data: emptyCollection() });
  if (!map.getLayer("fitx-route-casing")) map.addLayer({ id: "fitx-route-casing", type: "line", source: "fitx-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": surface, "line-width": 9, "line-opacity": 0.9 } });
  if (!map.getLayer("fitx-route-line")) map.addLayer({ id: "fitx-route-line", type: "line", source: "fitx-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": primary, "line-width": 5 } });
  if (!map.getLayer("fitx-ends")) map.addLayer({ id: "fitx-ends", type: "circle", source: "fitx-ends", paint: { "circle-radius": 6, "circle-color": ["match", ["get", "kind"], "start", surface, primary], "circle-stroke-color": ["match", ["get", "kind"], "start", text, surface], "circle-stroke-width": 3 } });
  if (!map.getLayer("fitx-accuracy")) map.addLayer({ id: "fitx-accuracy", type: "fill", source: "fitx-accuracy", paint: { "fill-color": primary, "fill-opacity": 0.12 } });
  if (!map.getLayer("fitx-position")) map.addLayer({ id: "fitx-position", type: "circle", source: "fitx-position", paint: { "circle-radius": 8, "circle-color": primary, "circle-stroke-color": surface, "circle-stroke-width": 3 } });
}

export default function ActivityMap({ segments, version = 0, current = null, follow = false, showEnds = false, className, label }: ActivityMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const latest = useRef({ segments, current, showEnds });
  const [failed, setFailed] = useState<"webgl" | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [following, setFollowing] = useState(follow);
  const fittedRef = useRef(false);

  useEffect(() => {
    latest.current = { segments, current, showEnds };
  });

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: MapLibreMap;
    // A finished route opens framed on itself; a live map opens on the position (or all of India
    // until the first position arrives).
    const initialBounds = follow ? null : boundsOf(segments);
    try {
      configureWorker();
      map = new MapLibreMap({
        container,
        style: mapStyleUrl(isDarkTheme()),
        // Smooth edges on the route line.
        canvasContextAttributes: { antialias: true },
        attributionControl: { compact: false },
        ...(initialBounds
          ? { bounds: initialBounds, fitBoundsOptions: { padding: 48, maxZoom: 17 } }
          : { center: current ? [current.lng, current.lat] as [number, number] : [78.9629, 20.5937] as [number, number], zoom: current ? 16 : 3 }),
        // On a page that scrolls, one finger (or the mouse wheel) keeps scrolling the page; two
        // fingers or Ctrl + scroll move the map. The live recording map takes every gesture.
        cooperativeGestures: !follow,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        fadeDuration: 0,
        maxZoom: 19,
      });
    } catch {
      // No WebGL (old device, or disabled): the route is drawn without a map instead.
      const id = window.setTimeout(() => setFailed("webgl"), 0);
      return () => window.clearTimeout(id);
    }
    mapRef.current = map;
    if (initialBounds) fittedRef.current = true;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const sync = () => {
      if (isDarkTheme() && usesDefaultDarkStyle()) applyDarkPalette(map);
      addLayers(map);
      readyRef.current = true;
      const { segments: route, current: position, showEnds: ends } = latest.current;
      (map.getSource("fitx-route") as GeoJSONSource | undefined)?.setData(routeData(route));
      (map.getSource("fitx-ends") as GeoJSONSource | undefined)?.setData(ends ? endsData(route) : emptyCollection());
      if (!follow && !fittedRef.current) {
        const bounds = boundsOf(route);
        if (bounds) {
          map.fitBounds(bounds, { padding: 48, maxZoom: 17, animate: false });
          fittedRef.current = true;
        }
      }
      if (position) {
        (map.getSource("fitx-position") as GeoJSONSource | undefined)?.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [position.lng, position.lat] } });
        (map.getSource("fitx-accuracy") as GeoJSONSource | undefined)?.setData(accuracyCircle(position, position.acc));
      }
    };
    map.on("style.load", sync);
    // Network failures (style, tiles, fonts) carry an HTTP status; one missing tile is not worth a
    // message, repeated failures are.
    let networkErrors = 0;
    map.on("error", (event) => {
      const status = (event as unknown as { error?: { status?: unknown } }).error?.status;
      if (typeof status === "number" && ++networkErrors >= 3) setTilesFailed(true);
    });
    map.on("dragstart", () => setFollowing(false));
    let styleUrl = mapStyleUrl(isDarkTheme());
    const stopTheme = watchTheme(() => {
      const next = mapStyleUrl(isDarkTheme());
      if (next === styleUrl) return;
      styleUrl = next;
      readyRef.current = false;
      map.setStyle(next);
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);
    return () => {
      stopTheme();
      resize.disconnect();
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route and end markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("fitx-route") as GeoJSONSource | undefined)?.setData(routeData(segments));
    (map.getSource("fitx-ends") as GeoJSONSource | undefined)?.setData(showEnds ? endsData(segments) : emptyCollection());
    if (!follow && !fittedRef.current) {
      const bounds = boundsOf(segments);
      if (bounds) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 17, animate: false });
        fittedRef.current = true;
      }
    }
  }, [segments, version, showEnds, follow]);

  // Live position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !current) return;
    if (readyRef.current) {
      (map.getSource("fitx-position") as GeoJSONSource | undefined)?.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [current.lng, current.lat] } });
      (map.getSource("fitx-accuracy") as GeoJSONSource | undefined)?.setData(accuracyCircle(current, current.acc));
    }
    if (follow && following) map.easeTo({ center: [current.lng, current.lat], zoom: Math.max(map.getZoom(), 15), duration: 600 });
  }, [current, follow, following]);

  if (failed) {
    return (
      <div className={`${styles.frame} ${className ?? ""}`} role="img" aria-label={label}>
        <RouteSvg segments={segments} className="h-full w-full" />
        <p className={styles.notice}>Map unavailable on this device: showing the route only.</p>
      </div>
    );
  }

  return (
    <div className={`${styles.frame} ${className ?? ""}`}>
      <div ref={containerRef} className={styles.map} role="region" aria-label={label} />
      {tilesFailed && <p className={`${styles.notice} ${styles.clearOfZoom}`}>Map tiles couldn’t load. Your route is still being recorded.</p>}
      {follow && !following && current && (
        <button type="button" className={styles.recenter} onClick={() => setFollowing(true)} aria-label="Centre the map on your position">
          <LocateFixed size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
