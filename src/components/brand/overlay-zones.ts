/**
 * Where the intro's DOM graphics sit on each film composition (BRIEF-2 3.2 and 3.3): the letterbox
 * matte, the kinetic-title block, the data-callout areas and the end card's mark. One table serves
 * three readers: IntroFilmOverlay places the callouts from it (CSS custom properties), the shots keep
 * their `must` subjects out of it, and `verify.mjs --framing` checks the rendered frames against it
 * (`frameZones`, in the frame's own coordinates).
 *
 * Boxes are fractions of the viewport (x right, y down, 0..1), measured at each composition's
 * nominal screen (`NOMINAL_VIEWPORT`) from the overlay's CSS and rounded outward, so they hold the
 * graphic whatever its text. Pure: no DOM, no React.
 */

import { COMPOSITIONS, type FilmComposition } from "./films/compositions";
import { CALLOUTS, LETTERBOX, STAGE, STAGE_START, TITLES, type CalloutPlacement } from "./intro/timeline";

export type ZoneBox = { x0: number; y0: number; x1: number; y1: number };

/** The CSS-pixel screen each composition's zones were measured on (a real device of the band). */
export const NOMINAL_VIEWPORT: Readonly<Record<FilmComposition, { width: number; height: number }>> = {
  phone: { width: 390, height: 844 },
  "tablet-p": { width: 820, height: 1180 },
  "tablet-l": { width: 1180, height: 820 },
  laptop: { width: 1440, height: 810 },
  desktop: { width: 1920, height: 960 },
};

/**
 * The letterbox per composition, keyed in CSS on `<html data-fitx-film-cut>` (BRIEF-2 3.3): a 2.39:1
 * scope on laptop and desktop (each bar at most 14% of the height), a thin matte on the tablets and
 * the phone (a scope there would leave a postage stamp).
 */
export type Matte = { kind: "scope" } | { kind: "thin"; share: number; maxPx: number };

export const SCOPE_RATIO = 2.39;
export const SCOPE_MAX_SHARE = 0.14;

export const MATTES: Readonly<Record<FilmComposition, Matte>> = {
  phone: { kind: "thin", share: 0.05, maxPx: 44 },
  "tablet-p": { kind: "thin", share: 0.05, maxPx: 44 },
  "tablet-l": { kind: "thin", share: 0.04, maxPx: 40 },
  laptop: { kind: "scope" },
  desktop: { kind: "scope" },
};

/** One bar's height as a share of the viewport height, on a viewport of `viewAspect` (and, for thin mattes, `heightPx`). */
export function matteShare(comp: FilmComposition, viewAspect: number, heightPx?: number): number {
  const matte = MATTES[comp];
  if (matte.kind === "scope") return Math.min(SCOPE_MAX_SHARE, Math.max(0, (1 - viewAspect / SCOPE_RATIO) / 2));
  if (heightPx && heightPx > 0) return Math.min(matte.share, matte.maxPx / heightPx);
  return matte.share;
}

/** The kinetic titles' block (bottom left, above the bottom bar); every title word fits inside it. */
export const TITLE_ZONES: Readonly<Record<FilmComposition, ZoneBox>> = {
  phone: { x0: 0.05, y0: 0.81, x1: 0.86, y1: 0.92 },
  "tablet-p": { x0: 0.05, y0: 0.82, x1: 0.66, y1: 0.93 },
  "tablet-l": { x0: 0.05, y0: 0.74, x1: 0.67, y1: 0.93 },
  laptop: { x0: 0.05, y0: 0.61, x1: 0.67, y1: 0.85 },
  desktop: { x0: 0.05, y0: 0.68, x1: 0.55, y1: 0.89 },
};

/**
 * The data-callout areas by placement. Landscape compositions put side callouts a quarter of the way
 * down the picture; portrait ones ride the top, under the Skip pill, and the bottom callout clears
 * the title line.
 */
export const CALLOUT_ZONES: Readonly<Record<FilmComposition, Readonly<Record<CalloutPlacement, ZoneBox>>>> = {
  phone: {
    right: { x0: 0.48, y0: 0.12, x1: 0.94, y1: 0.26 },
    left: { x0: 0.06, y0: 0.12, x1: 0.52, y1: 0.26 },
    bottom: { x0: 0.12, y0: 0.64, x1: 0.88, y1: 0.79 },
  },
  "tablet-p": {
    right: { x0: 0.62, y0: 0.08, x1: 0.94, y1: 0.2 },
    left: { x0: 0.06, y0: 0.08, x1: 0.38, y1: 0.2 },
    bottom: { x0: 0.27, y0: 0.68, x1: 0.73, y1: 0.81 },
  },
  "tablet-l": {
    right: { x0: 0.69, y0: 0.24, x1: 0.94, y1: 0.4 },
    left: { x0: 0.06, y0: 0.24, x1: 0.31, y1: 0.4 },
    bottom: { x0: 0.34, y0: 0.72, x1: 0.66, y1: 0.93 },
  },
  laptop: {
    right: { x0: 0.7, y0: 0.28, x1: 0.94, y1: 0.45 },
    left: { x0: 0.06, y0: 0.28, x1: 0.3, y1: 0.45 },
    bottom: { x0: 0.35, y0: 0.63, x1: 0.65, y1: 0.85 },
  },
  desktop: {
    right: { x0: 0.73, y0: 0.26, x1: 0.94, y1: 0.41 },
    left: { x0: 0.06, y0: 0.26, x1: 0.27, y1: 0.41 },
    bottom: { x0: 0.38, y0: 0.7, x1: 0.62, y1: 0.88 },
  },
};

/** The end card's lockup (mark, wordmark and rule) at the centre: nothing in 6-brand may sit behind it. */
export const BRAND_ZONES: Readonly<Record<FilmComposition, ZoneBox>> = {
  phone: { x0: 0.25, y0: 0.36, x1: 0.75, y1: 0.64 },
  "tablet-p": { x0: 0.3, y0: 0.32, x1: 0.7, y1: 0.68 },
  "tablet-l": { x0: 0.36, y0: 0.24, x1: 0.64, y1: 0.76 },
  laptop: { x0: 0.39, y0: 0.24, x1: 0.61, y1: 0.76 },
  desktop: { x0: 0.41, y0: 0.28, x1: 0.59, y1: 0.72 },
};

export type CalloutId = (typeof CALLOUTS)[number]["id"];

/** A callout's placement on a composition (from `CALLOUTS`). */
export function calloutPlacement(id: CalloutId, comp: FilmComposition): CalloutPlacement {
  const callout = CALLOUTS.find((entry) => entry.id === id);
  if (!callout) throw new Error(`unknown callout ${id}`);
  return callout.placement[comp];
}

/** The area a callout occupies on a composition. */
export function calloutZone(id: CalloutId, comp: FilmComposition): ZoneBox {
  return CALLOUT_ZONES[comp][calloutPlacement(id, comp)];
}

export type TimedZone = { id: string; start: number; end: number; box: ZoneBox };

/** Every zone of a composition with the film times it is on screen, in viewport fractions at `viewAspect`. */
export function overlayZones(comp: FilmComposition, viewAspect: number = nominalAspect(comp)): TimedZone[] {
  const bar = matteShare(comp, viewAspect, NOMINAL_VIEWPORT[comp].height);
  const zones: TimedZone[] = [];
  if (bar > 0) {
    zones.push({ id: "letterbox-top", start: LETTERBOX.inStart, end: LETTERBOX.outEnd, box: { x0: 0, y0: 0, x1: 1, y1: bar } });
    zones.push({ id: "letterbox-bottom", start: LETTERBOX.inStart, end: LETTERBOX.outEnd, box: { x0: 0, y0: 1 - bar, x1: 1, y1: 1 } });
  }
  for (const title of TITLES) zones.push({ id: `title-${title.text.toLowerCase()}`, start: title.start, end: title.end, box: TITLE_ZONES[comp] });
  for (const callout of CALLOUTS) zones.push({ id: `callout-${callout.id}`, start: callout.start, end: callout.end, box: calloutZone(callout.id, comp) });
  zones.push({ id: "brand", start: STAGE_START[STAGE.brand], end: Number.POSITIVE_INFINITY, box: BRAND_ZONES[comp] });
  return zones;
}

/** The zones on screen at film time `time`. */
export function overlayZonesAt(comp: FilmComposition, time: number, viewAspect?: number): TimedZone[] {
  return overlayZones(comp, viewAspect).filter((zone) => time >= zone.start && time < zone.end);
}

export function nominalAspect(comp: FilmComposition): number {
  const { width, height } = NOMINAL_VIEWPORT[comp];
  return width / height;
}

function bandOf(comp: FilmComposition) {
  const band = COMPOSITIONS.find((entry) => entry.id === comp);
  if (!band) throw new Error(`unknown composition ${comp}`);
  return band;
}

/** A viewport box mapped into the frame of `comp` that a cover fit shows on a viewport of `viewAspect`. */
export function toFrame(box: ZoneBox, comp: FilmComposition, viewAspect: number): ZoneBox {
  const frameAspect = bandOf(comp).aspect;
  let rx0 = 0;
  let ry0 = 0;
  let rw = 1;
  let rh = 1;
  if (viewAspect < frameAspect) {
    rw = viewAspect / frameAspect;
    rx0 = (1 - rw) / 2;
  } else {
    rh = frameAspect / viewAspect;
    ry0 = (1 - rh) / 2;
  }
  return { x0: rx0 + box.x0 * rw, y0: ry0 + box.y0 * rh, x1: rx0 + box.x1 * rw, y1: ry0 + box.y1 * rh };
}

function union(a: ZoneBox, b: ZoneBox): ZoneBox {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * The zones of a composition in its frame's own coordinates, for `verify.mjs --framing --zones`: each
 * the union of where it lands at the band's two check edges (the matte measured at each edge), so a
 * subject clear of it is clear on every screen the cut is served to. `end` is finite (JSON).
 */
export function frameZones(comp: FilmComposition, duration: number): { id: string; comp: FilmComposition; start: number; end: number; box: ZoneBox }[] {
  const band = bandOf(comp);
  const atMin = overlayZones(comp, band.checkMin);
  const atMax = overlayZones(comp, band.checkMax);
  return atMin.map((zone, index) => {
    const other = atMax[index];
    const box = union(toFrame(zone.box, comp, band.checkMin), toFrame(other.box, comp, band.checkMax));
    return {
      id: zone.id,
      comp,
      start: zone.start,
      end: Math.min(duration, zone.end),
      box: { x0: round(box.x0), y0: round(box.y0), x1: round(box.x1), y1: round(box.y1) },
    };
  });
}
