/**
 * Draws the skeleton over the camera picture. Colours come from the FITX theme tokens of the
 * dark camera stage (read from CSS at runtime), never from literals.
 */
import { isConfident, SKELETON_CONNECTIONS, SKELETON_JOINTS } from "./landmarks";
import type { PosePoint } from "./landmarks";

export interface OverlayPalette {
  bone: string;
  focus: string;
  outline: string;
  faint: string;
}

/** Reads the overlay colours from the theme tokens in scope at `element`. */
export function readOverlayPalette(element: Element): OverlayPalette {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    bone: token("--fitx-on-inverse"),
    focus: token("--fitx-inverse-primary"),
    outline: token("--fitx-scrim"),
    faint: token("--fitx-on-inverse-disabled"),
  };
}

export interface DrawOptions {
  palette: OverlayPalette;
  /** Landmark indices the current exercise measures; drawn in the accent colour. */
  focus: ReadonlySet<number>;
  minVisibility: number;
  /**
   * Screen (CSS) pixels per canvas pixel, once the picture is fitted and zoomed: lines keep about the
   * same thickness on screen however far the framing zooms in.
   */
  pixelScale?: number;
}

/** Clears the canvas and draws `points` (image-normalised) at the canvas's own pixel size. */
export function drawPose(context: CanvasRenderingContext2D, points: readonly PosePoint[] | null, options: DrawOptions): void {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  if (!points) return;
  const line = options.pixelScale && options.pixelScale > 0 ? Math.max(1, 3.2 / options.pixelScale) : Math.max(2, Math.round(Math.min(width, height) / 160));
  const at = (point: PosePoint) => [point.x * width, point.y * height] as const;
  const seen = (index: number) => isConfident(points[index], options.minVisibility);

  context.lineCap = "round";
  context.lineJoin = "round";
  for (const pass of ["outline", "bone"] as const) {
    for (const [a, b] of SKELETON_CONNECTIONS) {
      const pa = points[a];
      const pb = points[b];
      if (!pa || !pb) continue;
      const clear = seen(a) && seen(b);
      const focused = clear && options.focus.has(a) && options.focus.has(b);
      context.setLineDash(clear ? [] : [line * 2, line * 2]);
      context.globalAlpha = pass === "outline" ? 0.55 : clear ? 1 : 0.6;
      context.strokeStyle = pass === "outline" ? options.palette.outline : focused ? options.palette.focus : clear ? options.palette.bone : options.palette.faint;
      context.lineWidth = pass === "outline" ? line + 3 : focused ? line + 1 : line;
      context.beginPath();
      context.moveTo(...at(pa));
      context.lineTo(...at(pb));
      context.stroke();
    }
  }
  context.setLineDash([]);
  for (const index of SKELETON_JOINTS) {
    const point = points[index];
    if (!point || !seen(index)) continue;
    const [x, y] = at(point);
    const radius = options.focus.has(index) ? line * 1.9 : line * 1.3;
    context.globalAlpha = 1;
    context.beginPath();
    context.arc(x, y, radius + 1.5, 0, Math.PI * 2);
    context.fillStyle = options.palette.outline;
    context.fill();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = options.focus.has(index) ? options.palette.focus : options.palette.bone;
    context.fill();
  }
  context.globalAlpha = 1;
}
