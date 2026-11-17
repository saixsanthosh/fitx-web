import { localDateKey } from "./format";
import { decodeRoute } from "./polyline";
import {
  busyness, calmerBand, CARD_SIZE, coverRect, photoLayout, relativeLuminance, requiredScrimAlpha, routeLayout,
  type Box, type CardData, type CardFormat, type CardLayout, type CardOp, type Rgb, type TextRole,
} from "./share-layouts";
import type { LatLng } from "./types";

/*
 * Share images for a finished activity, drawn on a canvas: 1080x1920 (Story, 9:16), 1080x1350
 * (Post, 4:5) and 1080x1080 (Square, 1:1). The route is the privacy-trimmed one (nothing near the
 * start or finish), drawn as a line: no map tiles, so no third-party imagery and no attribution.
 * Without a photo the card is the FITX dark band; with the person's own photo, the photo fills the
 * card and the numbers sit in its calmer half over a scrim measured to keep them readable. The
 * photo never leaves the device: it is drawn here and the result re-encoded, which also drops the
 * photo's EXIF and location tags. Colours and fonts are read from the page's FITX tokens.
 */

export { CARD_FORMATS, CARD_SIZE, cardHeroes, cardStats, routeState, type Box, type CardData, type CardFormat } from "./share-layouts";

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

/** The person's photo, decoded in the browser, and where its crop sits (0 top, 0.5 centre, 1 bottom). */
export type SharePhoto = { image: CanvasImageSource; width: number; height: number; focusY: number };

type Palette = { bg: string; text: string; muted: string; accent: string; line: string; scrim: string };
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
      text: token(root, "--fitx-on-inverse"),
      muted: token(root, "--fitx-on-inverse-secondary"),
      accent: token(root, "--fitx-inverse-primary"),
      line: token(root, "--fitx-inverse-border"),
      scrim: token(root, "--fitx-scrim"),
    },
    fonts: { display: family("--font-manrope", "sans-serif"), body: family("--font-inter", "sans-serif") },
  };
}

/** A CSS colour as sRGB channels, read through a 1x1 canvas (works for any colour syntax). */
function rgbOf(color: string): Rgb {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [0, 0, 0];
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
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

function strokePath(ctx: CanvasRenderingContext2D, segment: readonly ScreenPoint[]): void {
  if (!segment.length) return;
  ctx.beginPath();
  ctx.moveTo(segment[0].x, segment[0].y);
  for (let i = 1; i < segment.length; i++) ctx.lineTo(segment[i].x, segment[i].y);
  ctx.stroke();
}

function drawRoute(ctx: CanvasRenderingContext2D, segments: readonly (readonly LatLng[])[], box: Box, palette: Palette, onPhoto: boolean): void {
  const route = fitRoute(segments, box, Math.min(24, box.width * 0.06));
  if (!route.length) return;
  const width = Math.max(6, Math.min(12, box.width / 40));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (onPhoto) {
    // A dark casing keeps the line visible on any photo.
    ctx.strokeStyle = palette.scrim;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = width + 10;
    for (const segment of route) strokePath(ctx, segment);
  } else {
    // A soft glow under a crisp line.
    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = width * 2.8;
    ctx.shadowColor = palette.accent;
    ctx.shadowBlur = 40;
    for (const segment of route) strokePath(ctx, segment);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = width;
  for (const segment of route) strokePath(ctx, segment);
  ctx.restore();
}

function drawOps(ctx: CanvasRenderingContext2D, layout: CardLayout, data: CardData, palette: Palette, fonts: Fonts): void {
  const color = (role: TextRole) => (role === "text" ? palette.text : role === "muted" ? palette.muted : palette.accent);
  const segments = decodeRoute(data.sharePolyline);
  for (const op of layout.ops as CardOp[]) {
    if (op.kind === "mark") {
      drawMark(ctx, op.x, op.y, op.size, palette.text);
    } else if (op.kind === "rule") {
      ctx.fillStyle = palette.line;
      ctx.fillRect(op.x, op.y, op.width, 2);
    } else if (op.kind === "route") {
      drawRoute(ctx, segments, op.box, palette, layout.mode === "photo");
    } else if (op.kind === "text") {
      ctx.font = `${op.weight} ${op.size}px ${op.font === "display" ? fonts.display : fonts.body}`;
      ctx.fillStyle = color(op.role);
      ctx.textAlign = op.align;
      ctx.textBaseline = op.baseline;
      ctx.fillText(fitText(ctx, op.text, op.maxWidth), op.x, op.y);
    } else {
      // A number is never cut short: the whole value and unit shrink together until they fit.
      let size = op.size;
      let unitSize = op.unitSize;
      const measure = () => {
        ctx.font = `800 ${size}px ${fonts.display}`;
        const value = ctx.measureText(op.value).width;
        ctx.font = `700 ${unitSize}px ${fonts.display}`;
        const unit = op.unit ? ctx.measureText(op.unit).width + unitSize * 0.25 : 0;
        return { value, unit };
      };
      let widths = measure();
      if (widths.value + widths.unit > op.maxWidth) {
        const factor = Math.max(0.4, op.maxWidth / (widths.value + widths.unit));
        size = Math.floor(size * factor);
        unitSize = Math.floor(unitSize * factor);
        widths = measure();
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = `800 ${size}px ${fonts.display}`;
      ctx.fillStyle = color(op.role);
      ctx.fillText(op.value, op.x, op.y);
      if (op.unit) {
        ctx.font = `700 ${unitSize}px ${fonts.display}`;
        ctx.fillStyle = color(op.unitRole);
        ctx.fillText(op.unit, op.x + widths.value + unitSize * 0.25, op.y);
      }
    }
  }
}

/** Luminance (0-1) of a downscaled copy of `canvas` rows [y0, y1), and its column count. */
function lumaOf(canvas: HTMLCanvasElement, y0: number, y1: number, columns = 54): { luma: Float32Array; columns: number } {
  const rows = Math.max(1, Math.round((columns * (y1 - y0)) / canvas.width));
  const sample = document.createElement("canvas");
  sample.width = columns;
  sample.height = rows;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { luma: new Float32Array(), columns };
  ctx.drawImage(canvas, 0, y0, canvas.width, y1 - y0, 0, 0, columns, rows);
  const data = ctx.getImageData(0, 0, columns, rows).data;
  const luma = new Float32Array(columns * rows);
  for (let i = 0; i < luma.length; i++) luma[i] = relativeLuminance([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  return { luma, columns };
}

/** RGBA pixels of a downscaled copy (about 1/6) of `box` on `canvas`. */
function pixelsOf(canvas: HTMLCanvasElement, box: Box): Uint8ClampedArray {
  const columns = Math.max(1, Math.round(box.width / 6));
  const rows = Math.max(1, Math.round(box.height / 6));
  const sample = document.createElement("canvas");
  sample.width = columns;
  sample.height = rows;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Uint8ClampedArray();
  ctx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, columns, rows);
  return ctx.getImageData(0, 0, columns, rows).data;
}

/** Scrim opacity bounds: never so light the card looks unfinished, never black. */
const SCRIM_MIN = 0.3;
const SCRIM_MAX = 0.9;

/** Draws the card onto `canvas` (resized to the format). Fonts must already be loaded. */
export function drawShareCard(canvas: HTMLCanvasElement, data: CardData, format: CardFormat, host: string, photo: SharePhoto | null = null): CardLayout {
  const { width, height } = CARD_SIZE[format];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const { palette, fonts } = readTheme();

  if (!photo) {
    const layout = routeLayout(data, format, host);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, height);
    drawOps(ctx, layout, data, palette, fonts);
    return layout;
  }

  // The photo, cover-cropped. Then the numbers go in its calmer half, over a scrim just dark enough.
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);
  const crop = coverRect(photo.width, photo.height, width, height, photo.focusY);
  ctx.drawImage(photo.image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  const half = Math.round(height * 0.45);
  const top = lumaOf(canvas, 0, half);
  const bottom = lumaOf(canvas, height - half, height);
  const layout = photoLayout(data, format, calmerBand(busyness(top.luma, top.columns), busyness(bottom.luma, bottom.columns)));
  const area = layout.textArea as Box;
  const alpha = Math.min(SCRIM_MAX, Math.max(SCRIM_MIN, requiredScrimAlpha(pixelsOf(canvas, area), rgbOf(palette.text), rgbOf(palette.scrim))));

  // Solid under the text, then a soft fade into the photo.
  const feather = Math.round(height * 0.12);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = palette.scrim;
  if (layout.band === "top") {
    const edge = area.y + area.height;
    ctx.fillRect(0, 0, width, edge);
    const fade = ctx.createLinearGradient(0, edge, 0, edge + feather);
    fade.addColorStop(0, palette.scrim);
    fade.addColorStop(1, "transparent");
    ctx.fillStyle = fade;
    ctx.fillRect(0, edge, width, feather);
  } else {
    ctx.fillRect(0, area.y, width, height - area.y);
    const fade = ctx.createLinearGradient(0, area.y, 0, area.y - feather);
    fade.addColorStop(0, palette.scrim);
    fade.addColorStop(1, "transparent");
    ctx.fillStyle = fade;
    ctx.fillRect(0, area.y - feather, width, feather);
  }
  ctx.restore();
  drawOps(ctx, layout, data, { ...palette, muted: palette.text }, fonts);
  return layout;
}

/** Renders the card: PNG for the FITX band, JPEG (much smaller for a full photo) with a photo. */
export async function renderShareCard(data: CardData, format: CardFormat, host: string, photo: SharePhoto | null = null): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  drawShareCard(canvas, data, format, host, photo);
  const type = photo ? "image/jpeg" : "image/png";
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // Free the canvas memory at once (a 1080x1920 canvas is about 8 MB).
      canvas.width = 0;
      canvas.height = 0;
      if (blob) resolve(blob);
      else reject(new Error("The image could not be created"));
    }, type, photo ? 0.9 : undefined);
  });
}

export function cardFileName(data: CardData, format: CardFormat, withPhoto = false): string {
  return `fitx-${data.sport}-${localDateKey(data.startedAt)}-${format}.${withPhoto ? "jpg" : "png"}`;
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
