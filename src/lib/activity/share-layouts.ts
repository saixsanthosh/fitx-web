import { usesPace } from "./config";
import { formatDuration, kmValue, paceValue, speedValue } from "./format";
import { decodeRoute } from "./polyline";
import type { ActivitySource, Sport } from "./types";

/*
 * What goes on an activity's share image, and where. Pure: the canvas drawing (share-card.ts) only
 * paints what this module lays out, so the rules are tested here:
 *  - Only recorded numbers appear. An unknown pace, speed, climb or calorie figure is left out,
 *    never drawn as a dash or a zero. Climb appears whenever it was recorded; calories only as an
 *    estimate, labelled so.
 *  - Each sport leads with what matters for it: runs with pace, walks with time, rides with speed
 *    (and a big climb as a second headline).
 *  - The route is drawn only when the privacy-trimmed route has something left; an activity whose
 *    route was all near its start or finish says so in one line instead of an empty frame.
 *  - Two compositions: "route" (the FITX dark band with a large route) and "photo" (the person's
 *    own photo, with the numbers in its calmer half over a scrim computed for contrast).
 */

export type CardFormat = "story" | "feed" | "square";
export const CARD_FORMATS: readonly CardFormat[] = ["story", "feed", "square"];
export const CARD_SIZE: Record<CardFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  feed: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
};

export type CardData = {
  sport: Sport;
  title: string;
  startedAt: number;
  distanceM: number;
  movingSeconds: number;
  avgSpeedMps: number | null;
  avgPaceSecondsPerKm: number | null;
  kcal: number | null;
  elevationGainM: number | null;
  sharePolyline: string;
  /** The activity had a GPS route, even if nothing is left after the privacy trim (default: whether sharePolyline has one). */
  hadRoute?: boolean;
  /** Climb from a FITX recording is GPS altitude; an imported file's may be barometric. */
  source?: ActivitySource;
};

export type CardStat = { key: "pace" | "speed" | "moving" | "climb" | "kcal"; label: string; value: string; unit: string };
export type CardHero = { key: "distance" | "climb"; label: string; value: string; unit: string };

/** A ride's climb this big becomes a second headline. */
export const RIDE_CLIMB_HERO_M = 100;

const climbLabel = (data: CardData) => (data.source === "file" ? "Climb" : "Climb (GPS)");

function climbStat(data: CardData): CardStat | null {
  if (data.elevationGainM === null || !Number.isFinite(data.elevationGainM)) return null;
  return { key: "climb", label: climbLabel(data), value: String(Math.round(data.elevationGainM)), unit: "m" };
}

function ridePromotesClimb(data: CardData): boolean {
  return data.sport === "ride" && data.elevationGainM !== null && data.elevationGainM >= RIDE_CLIMB_HERO_M;
}

/** The headline numbers: distance always, and a ride's big climb. */
export function cardHeroes(data: CardData): CardHero[] {
  const heroes: CardHero[] = [{ key: "distance", label: "Distance", value: kmValue(data.distanceM), unit: "km" }];
  if (ridePromotesClimb(data)) heroes.push({ key: "climb", label: climbLabel(data), value: String(Math.round(data.elevationGainM as number)), unit: "m" });
  return heroes;
}

/** The numbers under the headline, in the sport's order, recorded ones only (at most four). */
export function cardStats(data: CardData): CardStat[] {
  const moving: CardStat = { key: "moving", label: "Moving time", value: formatDuration(data.movingSeconds), unit: "" };
  const paceText = paceValue(data.avgPaceSecondsPerKm);
  const speedText = speedValue(data.avgSpeedMps);
  const pace: CardStat | null = usesPace(data.sport) && paceText !== "–" ? { key: "pace", label: "Avg pace", value: paceText, unit: "/km" } : null;
  const speed: CardStat | null = !usesPace(data.sport) && speedText !== "–" ? { key: "speed", label: "Avg speed", value: speedText, unit: "km/h" } : null;
  const climb = ridePromotesClimb(data) ? null : climbStat(data);
  const kcal: CardStat | null = data.kcal !== null && Number.isFinite(data.kcal) ? { key: "kcal", label: "Calories (est.)", value: String(Math.round(data.kcal)), unit: "kcal" } : null;
  const order = data.sport === "run" ? [pace, moving, climb, kcal] : data.sport === "walk" ? [moving, pace, climb, kcal] : [speed, moving, climb, kcal];
  return order.filter((stat): stat is CardStat => stat !== null);
}

/** "shown": a route to draw; "hidden": the whole route was near the start or finish; "none": no GPS route. */
export function routeState(data: CardData): "shown" | "hidden" | "none" {
  if (decodeRoute(data.sharePolyline).some((segment) => segment.length > 1)) return "shown";
  const had = data.hadRoute ?? false;
  return had ? "hidden" : "none";
}

export const ROUTE_HIDDEN_NOTE = "Route hidden near start and finish";
const SPORT_WORD: Record<Sport, string> = { walk: "WALK", run: "RUN", ride: "RIDE" };

export function cardMeta(data: CardData): string {
  const date = new Date(data.startedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `${SPORT_WORD[data.sport]} · ${date}`;
}

// ---------------------------------------------------------------------------------------------
// Layout: a list of drawing operations in canvas pixels.

export type Box = { x: number; y: number; width: number; height: number };
export type TextRole = "text" | "muted" | "accent";
export type CardOp =
  | { kind: "mark"; x: number; y: number; size: number }
  | { kind: "text"; text: string; x: number; y: number; size: number; weight: number; font: "display" | "body"; role: TextRole; align: "left" | "right" | "center"; baseline: "alphabetic" | "middle"; maxWidth: number }
  /** A number with its unit after it. Shrunk to fit `maxWidth`, never cut short. */
  | { kind: "value"; value: string; unit: string; x: number; y: number; size: number; unitSize: number; role: TextRole; unitRole: TextRole; maxWidth: number }
  | { kind: "route"; box: Box }
  | { kind: "rule"; x: number; y: number; width: number };

export type CardLayout = {
  width: number;
  height: number;
  mode: "route" | "photo";
  ops: CardOp[];
  /** Photo mode: the area the text sits in, which the scrim must make legible; and which edge it hangs from. */
  textArea: Box | null;
  band: "top" | "bottom" | null;
  route: "shown" | "hidden" | "none";
};

type Scale = {
  margin: number;
  brandTop: number;
  markSize: number;
  wordSize: number;
  metaSize: number;
  titleSize: number;
  heroSize: number;
  heroUnitSize: number;
  heroLabelSize: number;
  secondHeroSize: number;
  statLabelSize: number;
  statValueSize: number;
  statUnitSize: number;
  noteSize: number;
};

const ROUTE_SCALE: Record<CardFormat, Scale> = {
  story: { margin: 84, brandTop: 120, markSize: 64, wordSize: 40, metaSize: 30, titleSize: 40, heroSize: 210, heroUnitSize: 64, heroLabelSize: 28, secondHeroSize: 120, statLabelSize: 28, statValueSize: 64, statUnitSize: 28, noteSize: 28 },
  feed: { margin: 84, brandTop: 84, markSize: 64, wordSize: 40, metaSize: 30, titleSize: 40, heroSize: 180, heroUnitSize: 56, heroLabelSize: 26, secondHeroSize: 104, statLabelSize: 26, statValueSize: 52, statUnitSize: 24, noteSize: 26 },
  square: { margin: 72, brandTop: 72, markSize: 56, wordSize: 36, metaSize: 26, titleSize: 34, heroSize: 150, heroUnitSize: 46, heroLabelSize: 24, secondHeroSize: 88, statLabelSize: 22, statValueSize: 46, statUnitSize: 22, noteSize: 24 },
};

const PHOTO_SCALE: Record<CardFormat, Scale> = {
  story: { margin: 84, brandTop: 120, markSize: 64, wordSize: 40, metaSize: 30, titleSize: 38, heroSize: 200, heroUnitSize: 60, heroLabelSize: 30, secondHeroSize: 104, statLabelSize: 26, statValueSize: 60, statUnitSize: 26, noteSize: 26 },
  feed: { margin: 80, brandTop: 80, markSize: 60, wordSize: 38, metaSize: 28, titleSize: 34, heroSize: 170, heroUnitSize: 52, heroLabelSize: 28, secondHeroSize: 92, statLabelSize: 24, statValueSize: 52, statUnitSize: 24, noteSize: 24 },
  square: { margin: 68, brandTop: 68, markSize: 56, wordSize: 36, metaSize: 26, titleSize: 32, heroSize: 140, heroUnitSize: 44, heroLabelSize: 24, secondHeroSize: 80, statLabelSize: 22, statValueSize: 46, statUnitSize: 22, noteSize: 22 },
};

function brandOps(scale: Scale, width: number, top: number, meta: string): CardOp[] {
  const centre = top + scale.markSize * 0.42;
  return [
    { kind: "mark", x: scale.margin - 6, y: top - 6, size: scale.markSize },
    { kind: "text", text: "FITX", x: scale.margin + scale.markSize + 2, y: centre, size: scale.wordSize, weight: 800, font: "display", role: "text", align: "left", baseline: "middle", maxWidth: 400 },
    { kind: "text", text: meta, x: width - scale.margin, y: centre, size: scale.metaSize, weight: 600, font: "body", role: "muted", align: "right", baseline: "middle", maxWidth: width - 2 * scale.margin - scale.markSize - 200 },
  ];
}

/** Stats in a row, or a 2 x 2 grid when `grid`; returns the ops and the height used. */
function statOps(stats: readonly CardStat[], scale: Scale, x: number, top: number, width: number, grid: boolean, labelRole: TextRole): { ops: CardOp[]; height: number } {
  if (!stats.length) return { ops: [], height: 0 };
  const columns = grid ? 2 : stats.length;
  const columnWidth = width / columns;
  const rowHeight = scale.statLabelSize + scale.statValueSize * 1.45;
  const ops: CardOp[] = [];
  stats.forEach((stat, i) => {
    const cx = x + (i % columns) * columnWidth;
    const cy = top + Math.floor(i / columns) * (rowHeight + scale.statLabelSize * 0.6);
    ops.push({ kind: "text", text: stat.label.toUpperCase(), x: cx, y: cy + scale.statLabelSize, size: scale.statLabelSize, weight: 600, font: "body", role: labelRole, align: "left", baseline: "alphabetic", maxWidth: columnWidth - 20 });
    ops.push({ kind: "value", value: stat.value, unit: stat.unit, x: cx, y: cy + scale.statLabelSize + scale.statValueSize * 1.2, size: scale.statValueSize, unitSize: scale.statUnitSize, role: "text", unitRole: labelRole, maxWidth: columnWidth - 20 });
  });
  const rows = Math.ceil(stats.length / columns);
  return { ops, height: rows * rowHeight + (rows - 1) * scale.statLabelSize * 0.6 };
}

/** The "route" composition: the FITX dark band, a large route, then title, distance and stats. */
export function routeLayout(data: CardData, format: CardFormat, host: string): CardLayout {
  const { width, height } = CARD_SIZE[format];
  const scale = ROUTE_SCALE[format];
  const m = scale.margin;
  const inner = width - 2 * m;
  const route = routeState(data);
  const heroes = cardHeroes(data);
  const stats = cardStats(data);
  const grid = format === "story" && stats.length > 3;
  const ops: CardOp[] = brandOps(scale, width, scale.brandTop, cardMeta(data));

  const footerY = height - (format === "story" ? 110 : format === "feed" ? 70 : 60);
  const brandBottom = scale.brandTop + scale.markSize;
  const routeTop = brandBottom + (format === "story" ? 76 : 52);
  const routeToTitle = format === "story" ? 110 : 70;
  const footerSpace = scale.noteSize * 2.4;

  // The block under the route, from the title's baseline: headline(s), a rule, then the stats.
  const titleGap = scale.heroSize * 0.95;
  const secondHero = heroes[1] ?? null;
  const ruleGap = scale.heroSize * 0.42;
  const statsHeight = statOps(stats, scale, m, 0, inner, grid, "muted").height;
  const blockHeight = titleGap
    + (secondHero ? scale.heroLabelSize * 2.6 + scale.secondHeroSize * 1.05 : 0)
    + (stats.length ? ruleGap + scale.statLabelSize * 1.6 + statsHeight : 0);

  let titleY: number;
  if (route === "shown") {
    // The route takes the room the numbers leave (as tall as the format allows).
    const tallest = format === "story" ? 860 : format === "feed" ? 560 : 340;
    const routeHeight = Math.max(200, Math.min(tallest, footerY - footerSpace - routeTop - routeToTitle - blockHeight));
    ops.push({ kind: "route", box: { x: m, y: routeTop, width: inner, height: routeHeight } });
    titleY = routeTop + routeHeight + routeToTitle;
  } else {
    // No route to draw: the numbers take the middle of the card.
    const free = footerY - footerSpace - brandBottom;
    titleY = brandBottom + Math.max(scale.titleSize * 2, (free - blockHeight - scale.titleSize) / 2) + scale.titleSize;
  }
  ops.push({ kind: "text", text: data.title, x: m, y: titleY, size: scale.titleSize, weight: 600, font: "body", role: "muted", align: "left", baseline: "alphabetic", maxWidth: inner });
  let y = titleY + titleGap;
  ops.push({ kind: "value", value: heroes[0].value, unit: heroes[0].unit, x: m - 8, y, size: scale.heroSize, unitSize: scale.heroUnitSize, role: "text", unitRole: "accent", maxWidth: inner });
  if (secondHero) {
    y += scale.heroLabelSize * 2.6;
    ops.push({ kind: "text", text: secondHero.label.toUpperCase(), x: m, y, size: scale.heroLabelSize, weight: 600, font: "body", role: "muted", align: "left", baseline: "alphabetic", maxWidth: inner });
    y += scale.secondHeroSize * 1.05;
    ops.push({ kind: "value", value: secondHero.value, unit: secondHero.unit, x: m - 4, y, size: scale.secondHeroSize, unitSize: scale.heroUnitSize * 0.8, role: "text", unitRole: "accent", maxWidth: inner });
  }
  if (stats.length) {
    y += ruleGap;
    ops.push({ kind: "rule", x: m, y, width: inner });
    y += scale.statLabelSize * 1.6;
    ops.push(...statOps(stats, scale, m, y, inner, grid, "muted").ops);
  }

  if (route === "hidden") ops.push({ kind: "text", text: ROUTE_HIDDEN_NOTE, x: m, y: footerY - scale.noteSize * 1.8, size: scale.noteSize, weight: 500, font: "body", role: "muted", align: "left", baseline: "alphabetic", maxWidth: inner });
  ops.push({ kind: "text", text: "Tracked with FITX", x: m, y: footerY, size: scale.noteSize, weight: 500, font: "body", role: "muted", align: "left", baseline: "alphabetic", maxWidth: inner / 2 });
  if (host) ops.push({ kind: "text", text: host, x: width - m, y: footerY, size: scale.noteSize, weight: 500, font: "body", role: "muted", align: "right", baseline: "alphabetic", maxWidth: inner / 2 });
  return { width, height, mode: "route", ops, textArea: null, band: null, route };
}

/**
 * The "photo" composition: the numbers hang from the top or the bottom edge (`band`, the calmer
 * half of the photo), left-aligned, with a small route beside the distance.
 */
export function photoLayout(data: CardData, format: CardFormat, band: "top" | "bottom"): CardLayout {
  const { width, height } = CARD_SIZE[format];
  const scale = PHOTO_SCALE[format];
  const m = scale.margin;
  const inner = width - 2 * m;
  const route = routeState(data);
  const heroes = cardHeroes(data);
  const stats = cardStats(data);
  const grid = format === "story" && stats.length > 3;
  const secondHero = heroes[1] ?? null;

  // Block heights, top to bottom: brand, headline(s) with the route beside them, stats, title.
  const brandHeight = scale.markSize;
  const gapA = Math.round(scale.heroSize * 0.42);
  const heroHeight = scale.heroLabelSize * 1.4 + scale.heroSize * 0.95 + (secondHero ? scale.heroLabelSize * 1.8 + scale.secondHeroSize : 0);
  const gapB = Math.round(scale.heroSize * 0.3);
  const statsHeight = statOps(stats, scale, m, 0, inner, grid, "text").height;
  const gapC = Math.round(scale.heroSize * 0.22);
  const noteHeight = route === "hidden" ? scale.noteSize * 1.8 : 0;
  const total = brandHeight + gapA + heroHeight + (stats.length ? gapB + statsHeight : 0) + gapC + scale.titleSize + noteHeight;
  const edge = scale.brandTop;
  const top = band === "top" ? edge : height - edge - total;

  const ops: CardOp[] = brandOps(scale, width, top, cardMeta(data));
  let y = top + brandHeight + gapA;
  const routeWidth = Math.round(inner * 0.34);
  const heroWidth = route === "shown" ? inner - routeWidth - 32 : inner;
  ops.push({ kind: "text", text: heroes[0].label.toUpperCase(), x: m, y: y + scale.heroLabelSize, size: scale.heroLabelSize, weight: 700, font: "body", role: "text", align: "left", baseline: "alphabetic", maxWidth: heroWidth });
  ops.push({ kind: "value", value: heroes[0].value, unit: heroes[0].unit, x: m - 6, y: y + scale.heroLabelSize * 1.4 + scale.heroSize * 0.82, size: scale.heroSize, unitSize: scale.heroUnitSize, role: "text", unitRole: "text", maxWidth: heroWidth });
  if (secondHero) {
    const y2 = y + scale.heroLabelSize * 1.4 + scale.heroSize * 0.95 + scale.heroLabelSize * 1.4;
    ops.push({ kind: "text", text: secondHero.label.toUpperCase(), x: m, y: y2, size: scale.heroLabelSize, weight: 700, font: "body", role: "text", align: "left", baseline: "alphabetic", maxWidth: heroWidth });
    ops.push({ kind: "value", value: secondHero.value, unit: secondHero.unit, x: m - 4, y: y2 + scale.secondHeroSize * 0.95, size: scale.secondHeroSize, unitSize: scale.heroUnitSize * 0.8, role: "text", unitRole: "text", maxWidth: heroWidth });
  }
  if (route === "shown") ops.push({ kind: "route", box: { x: width - m - routeWidth, y, width: routeWidth, height: heroHeight } });
  y += heroHeight;
  if (stats.length) {
    y += gapB;
    ops.push(...statOps(stats, scale, m, y, inner, grid, "text").ops);
    y += statsHeight;
  }
  y += gapC + scale.titleSize;
  ops.push({ kind: "text", text: data.title, x: m, y, size: scale.titleSize, weight: 600, font: "body", role: "text", align: "left", baseline: "alphabetic", maxWidth: inner });
  if (route === "hidden") {
    y += noteHeight;
    ops.push({ kind: "text", text: ROUTE_HIDDEN_NOTE, x: m, y, size: scale.noteSize, weight: 500, font: "body", role: "text", align: "left", baseline: "alphabetic", maxWidth: inner });
  }
  const pad = Math.round(scale.markSize * 0.6);
  const textArea = { x: 0, y: Math.max(0, top - pad), width, height: Math.min(height, total + 2 * pad) };
  return { width, height, mode: "photo", ops, textArea, band, route };
}

// ---------------------------------------------------------------------------------------------
// Photo maths: cropping, choosing the calmer half, and a scrim dark enough for the text.

export type Crop = { sx: number; sy: number; sw: number; sh: number };

/**
 * The part of a `srcW` x `srcH` photo that covers a `dstW` x `dstH` card without distortion, with the
 * crop placed by `focusY` (0 top, 0.5 centre, 1 bottom) and centred horizontally.
 */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number, focusY = 0.5): Crop {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = Math.min(srcW, dstW / scale);
  const sh = Math.min(srcH, dstH / scale);
  const focus = Math.min(1, Math.max(0, focusY));
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) * focus, sw, sh };
}

export type Rgb = readonly [number, number, number];

const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an sRGB colour (0-255 channels). */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The colour of `pixel` under a layer of `scrim` at `alpha` (canvas source-over, in sRGB). */
export function composite(pixel: Rgb, scrim: Rgb, alpha: number): Rgb {
  return [alpha * scrim[0] + (1 - alpha) * pixel[0], alpha * scrim[1] + (1 - alpha) * pixel[1], alpha * scrim[2] + (1 - alpha) * pixel[2]];
}

/**
 * Text needs more than WCAG's 4.5:1 here: the photo is measured on a downscaled copy, which
 * averages away small bright spots, so the target carries a margin.
 */
export const SCRIM_TARGET_CONTRAST = 5;

/**
 * The least scrim opacity that gives `text` at least `target` contrast against every pixel of
 * `pixels` (RGBA, as getImageData returns them) once the scrim is laid over it.
 */
export function requiredScrimAlpha(pixels: ArrayLike<number>, text: Rgb, scrim: Rgb, target = SCRIM_TARGET_CONTRAST): number {
  const textL = relativeLuminance(text);
  const limit = (textL + 0.05) / target - 0.05;
  if (limit <= relativeLuminance(scrim)) return 1;
  const ok = (alpha: number) => {
    for (let i = 0; i + 2 < pixels.length; i += 4) {
      if (relativeLuminance(composite([pixels[i], pixels[i + 1], pixels[i + 2]], scrim, alpha)) > limit) return false;
    }
    return true;
  };
  if (ok(0)) return 0;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** How busy an area of a photo is (luminance spread plus edges); lower is calmer. `luma` is row-major, 0-1. */
export function busyness(luma: ArrayLike<number>, columns: number): number {
  const n = luma.length;
  if (!n || columns <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += luma[i];
  const mean = sum / n;
  let variance = 0;
  let edges = 0;
  let edgeCount = 0;
  for (let i = 0; i < n; i++) {
    variance += (luma[i] - mean) ** 2;
    if ((i + 1) % columns !== 0 && i + 1 < n) { edges += Math.abs(luma[i + 1] - luma[i]); edgeCount++; }
    if (i + columns < n) { edges += Math.abs(luma[i + columns] - luma[i]); edgeCount++; }
  }
  return Math.sqrt(variance / n) + 2 * (edgeCount ? edges / edgeCount : 0);
}

/** The calmer of the photo's top and bottom parts for the text (the top on a tie). */
export function calmerBand(top: number, bottom: number): "top" | "bottom" {
  return bottom < top - 0.01 ? "bottom" : "top";
}
