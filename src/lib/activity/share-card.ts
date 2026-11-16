import { usesPace } from "./config";
import { formatDuration, kmValue, paceValue, speedValue } from "./format";
import { decodeRoute } from "./polyline";
import type { LatLng, Sport } from "./types";

/*
 * Share images for a finished activity, drawn on a canvas: 1080x1920 for WhatsApp Status and
 * Stories, 1080x1350 for feeds. The route is the privacy-trimmed one (nothing near the start or
 * finish) drawn as a line on the FITX dark band: no map tiles, so no third-party imagery and no
 * attribution are needed. Colours and fonts are read from the page's FITX tokens at draw time.
 */

export type CardFormat = "story" | "feed";
export const CARD_SIZE: Record<CardFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  feed: { width: 1080, height: 1350 },
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
};

export type Box = { x: number; y: number; width: number; height: number };
export type ScreenPoint = { x: number; y: number };

/**
 * Projects route segments into `box` (equirectangular around the route's middle latitude),
 * scaled uniformly to fit inside the box minus `padding` and centred. North is up.
 */
export function fitRoute(segments: readonly (readonly LatLng[])[], box: Box, padding = 0): ScreenPoint[][] {
  const points = segments.flat();
  if (!points.length) return [];
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLng - minLng) * k;
  const spanY = maxLat - minLat;
  const innerW = Math.max(1, box.width - 2 * padding);
  const innerH = Math.max(1, box.height - 2 * padding);
  const scale = spanX === 0 && spanY === 0 ? 0 : Math.min(spanX ? innerW / spanX : Infinity, spanY ? innerH / spanY : Infinity);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const midX = ((minLng + maxLng) / 2) * k;
  const midY = (minLat + maxLat) / 2;
  return segments.filter((s) => s.length).map((segment) => segment.map((p) => ({ x: cx + (p.lng * k - midX) * scale, y: cy - (p.lat - midY) * scale })));
}

/** The three numbers under the distance: moving time, pace or speed, then calories or climb. */
export function cardStats(data: CardData): Array<{ label: string; value: string; unit: string }> {
  const stats = [{ label: "Moving time", value: formatDuration(data.movingSeconds), unit: "" }];
  if (usesPace(data.sport)) stats.push({ label: "Avg pace", value: paceValue(data.avgPaceSecondsPerKm), unit: "/km" });
  else stats.push({ label: "Avg speed", value: speedValue(data.avgSpeedMps), unit: "km/h" });
  if (data.kcal !== null) stats.push({ label: "Calories (est.)", value: String(data.kcal), unit: "kcal" });
  else if (data.elevationGainM !== null) stats.push({ label: "Climb (GPS)", value: String(Math.round(data.elevationGainM)), unit: "m" });
  return stats;
}

type Palette = { bg: string; surface: string; text: string; muted: string; route: string; line: string };
type Fonts = { display: string; body: string };

function token(style: CSSStyleDeclaration, name: string): string {
  const value = style.getPropertyValue(name).trim();
  if (!value) throw new Error(`Missing theme token ${name}`);
  return value;
}

function readTheme(): { palette: Palette; fonts: Fonts } {
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const family = (name: string, fallback: string) => {
    const value = body.getPropertyValue(name).trim() || root.getPropertyValue(name).trim();
    return value ? `${value}, ${fallback}` : fallback;
  };
  return {
    palette: {
      bg: token(root, "--fitx-inverse-bg"),
      surface: token(root, "--fitx-inverse-surface"),
      text: token(root, "--fitx-on-inverse"),
      muted: token(root, "--fitx-on-inverse-secondary"),
      route: token(root, "--fitx-inverse-primary"),
      line: token(root, "--fitx-inverse-border"),
    },
    fonts: { display: family("--font-manrope", "sans-serif"), body: family("--font-inter", "sans-serif") },
  };
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** The FITX mark (as in FitxMark.tsx: cap, spine, crossbar and X) at `x, y` with `size`. */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const s = size / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5.5;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  ctx.beginPath();
  ctx.moveTo(10, 13); ctx.lineTo(54, 13);
  ctx.moveTo(32, 13); ctx.lineTo(32, 54);
  ctx.moveTo(10, 29); ctx.lineTo(32, 29);
  ctx.moveTo(32, 31); ctx.lineTo(53, 52);
  ctx.moveTo(32, 52); ctx.lineTo(53, 31);
  ctx.stroke();
  ctx.restore();
}

const SPORT_WORD: Record<Sport, string> = { walk: "WALK", run: "RUN", ride: "RIDE" };

/** Draws the card onto `canvas` (resized to the format). Fonts must already be loaded. */
export function drawShareCard(canvas: HTMLCanvasElement, data: CardData, format: CardFormat, host: string): void {
  const { width, height } = CARD_SIZE[format];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const { palette, fonts } = readTheme();
  const story = format === "story";
  const margin = 84;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  // Brand row.
  const top = story ? 120 : 84;
  drawMark(ctx, margin - 6, top - 6, 64, palette.text);
  ctx.fillStyle = palette.text;
  ctx.textBaseline = "middle";
  ctx.font = `800 40px ${fonts.display}`;
  ctx.fillText("FITX", margin + 66, top + 26);
  ctx.textAlign = "right";
  ctx.fillStyle = palette.muted;
  ctx.font = `600 30px ${fonts.body}`;
  const date = new Date(data.startedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  ctx.fillText(`${SPORT_WORD[data.sport]} · ${date}`, width - margin, top + 26);
  ctx.textAlign = "left";

  // Route.
  const routeBox: Box = story ? { x: margin, y: 260, width: width - 2 * margin, height: 860 } : { x: margin, y: 200, width: width - 2 * margin, height: 560 };
  const route = fitRoute(decodeRoute(data.sharePolyline), routeBox, 24);
  if (route.length) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = palette.route;
    // A soft glow under a crisp line.
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 34;
    ctx.shadowColor = palette.route;
    ctx.shadowBlur = 40;
    for (const segment of route) strokePath(ctx, segment);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.lineWidth = 12;
    for (const segment of route) strokePath(ctx, segment);
    ctx.restore();
  } else {
    ctx.save();
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 14]);
    ctx.strokeRect(routeBox.x + 0.5, routeBox.y + 0.5, routeBox.width - 1, routeBox.height - 1);
    ctx.restore();
    ctx.fillStyle = palette.muted;
    ctx.textAlign = "center";
    ctx.font = `500 30px ${fonts.body}`;
    ctx.fillText("Route kept private", width / 2, routeBox.y + routeBox.height / 2);
    ctx.textAlign = "left";
  }

  // Title, distance and stats.
  let y = routeBox.y + routeBox.height + (story ? 110 : 70);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = palette.muted;
  ctx.font = `600 40px ${fonts.body}`;
  ctx.fillText(fitText(ctx, data.title, width - 2 * margin), margin, y);

  y += story ? 200 : 170;
  ctx.fillStyle = palette.text;
  ctx.font = `800 ${story ? 210 : 180}px ${fonts.display}`;
  const distance = kmValue(data.distanceM);
  ctx.fillText(distance, margin - 8, y);
  const distanceWidth = ctx.measureText(distance).width;
  ctx.fillStyle = palette.route;
  ctx.font = `700 ${story ? 64 : 56}px ${fonts.display}`;
  ctx.fillText("km", margin + distanceWidth + 10, y);

  y += story ? 90 : 70;
  ctx.fillStyle = palette.line;
  ctx.fillRect(margin, y, width - 2 * margin, 2);

  const stats = cardStats(data);
  const column = (width - 2 * margin) / stats.length;
  y += story ? 80 : 66;
  stats.forEach((stat, i) => {
    const x = margin + i * column;
    ctx.fillStyle = palette.muted;
    ctx.font = `600 28px ${fonts.body}`;
    ctx.fillText(fitText(ctx, stat.label.toUpperCase(), column - 20), x, y);
    ctx.fillStyle = palette.text;
    ctx.font = `700 ${story ? 64 : 56}px ${fonts.display}`;
    const value = fitText(ctx, stat.value, column - 20);
    ctx.fillText(value, x, y + (story ? 78 : 68));
    if (stat.unit) {
      const valueWidth = ctx.measureText(value).width;
      ctx.fillStyle = palette.muted;
      ctx.font = `600 28px ${fonts.body}`;
      if (valueWidth + 12 + ctx.measureText(stat.unit).width <= column - 12) ctx.fillText(stat.unit, x + valueWidth + 12, y + (story ? 78 : 68));
    }
  });

  // Footer.
  ctx.fillStyle = palette.muted;
  ctx.font = `500 28px ${fonts.body}`;
  ctx.fillText("Tracked with FITX", margin, height - (story ? 110 : 70));
  if (host) {
    ctx.textAlign = "right";
    ctx.fillText(host, width - margin, height - (story ? 110 : 70));
    ctx.textAlign = "left";
  }
}

function strokePath(ctx: CanvasRenderingContext2D, segment: readonly ScreenPoint[]): void {
  if (!segment.length) return;
  ctx.beginPath();
  ctx.moveTo(segment[0].x, segment[0].y);
  for (let i = 1; i < segment.length; i++) ctx.lineTo(segment[i].x, segment[i].y);
  ctx.stroke();
}

/** Renders the card to a PNG blob (waits for the page fonts first). */
export async function renderShareCard(data: CardData, format: CardFormat, host: string): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  drawShareCard(canvas, data, format, host);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image could not be created"))), "image/png");
  });
}

export function cardFileName(data: CardData, format: CardFormat): string {
  const day = new Date(data.startedAt).toISOString().slice(0, 10);
  return `fitx-${data.sport}-${day}-${format}.png`;
}

export type ShareOutcome = "shared" | "cancelled" | "unsupported" | "failed";

/**
 * Hands the image to the phone's share sheet (Web Share API level 2). The person then picks the
 * app, and inside WhatsApp or Instagram chooses Status or Story where those apps offer it; a
 * website cannot post there itself. Only the file is shared: some apps drop files sent with text.
 */
export async function shareImageFile(file: File): Promise<ShareOutcome> {
  const nav = typeof navigator === "undefined" ? null : navigator;
  if (!nav?.share || !nav.canShare || !nav.canShare({ files: [file] })) return "unsupported";
  try {
    await nav.share({ files: [file] });
    return "shared";
  } catch (error) {
    return (error as { name?: string })?.name === "AbortError" ? "cancelled" : "failed";
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
