/**
 * Camera capture quality for AI Form Check, as plain functions the camera runtime applies and the
 * tests check. Three rules:
 *
 * - Ask for the highest native resolution worth having on this device (up to 4K), and report what
 *   the camera actually delivers. A picture is only called 4K when the track's own settings say so;
 *   nothing here ever enlarges a picture.
 * - Let the camera keep focus, exposure and white balance adjusting on its own where it offers those
 *   controls, and lift its exposure compensation a little when the room is dim.
 * - Brighten a dim picture for display only. The pose model always gets the camera's own frames, so
 *   tracking accuracy never depends on a visual effect.
 */

/** Rungs from the highest resolution down; the camera runtime steps down one rung when it must. */
export const CAPTURE_LADDER: ReadonlyArray<{ width: number; height: number }> = [
  { width: 3840, height: 2160 },
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 640, height: 480 },
  { width: 480, height: 360 },
];

/** The next smaller rung below a picture of this size, or null at the bottom. */
export function stepDown(size: { width: number; height: number }): { width: number; height: number } | null {
  const long = Math.max(size.width, size.height);
  return CAPTURE_LADDER.find((rung) => rung.width < long) ?? null;
}

export interface CaptureRequest {
  facing: "user" | "environment";
  width: number;
  height: number;
  frameRate: number;
  deviceId?: string;
}

/**
 * getUserMedia constraints for a native picture as close to `width` × `height` as the camera has.
 * `resizeMode: "none"` asks for one of the camera's own modes rather than a rescaled copy (browsers
 * that don't know it ignore it), and an `ideal` size never makes a camera fail to start.
 */
export function captureConstraints(request: CaptureRequest): MediaTrackConstraints {
  const constraints: MediaTrackConstraints & { resizeMode?: { ideal: string } } = {
    width: { ideal: request.width },
    height: { ideal: request.height },
    frameRate: { ideal: request.frameRate, max: 30 },
    resizeMode: { ideal: "none" },
    ...(request.deviceId ? { deviceId: { exact: request.deviceId } } : { facingMode: { ideal: request.facing } }),
  };
  return constraints;
}

/** What a track reports about its picture (MediaTrackSettings, narrowed). */
export interface DeliveredPicture {
  width?: number;
  height?: number;
  frameRate?: number;
}

/**
 * A short, honest name for the picture the camera delivers, from its own settings: "4K" only for a
 * real 2160-line picture. Null while the size is unknown.
 */
export function pictureLabel(picture: DeliveredPicture): string | null {
  if (!picture.width || !picture.height) return null;
  const lines = Math.min(picture.width, picture.height);
  if (lines >= 2160) return "4K";
  if (lines >= 1440) return "1440p";
  if (lines >= 1080) return "1080p";
  if (lines >= 720) return "720p";
  return `${lines}p`;
}

/** The camera controls this code uses (MediaTrackCapabilities, narrowed: most are not in the DOM types yet). */
export interface CameraControls {
  focusMode?: readonly string[];
  exposureMode?: readonly string[];
  whiteBalanceMode?: readonly string[];
  exposureCompensation?: { min?: number; max?: number; step?: number };
}

/**
 * Continuous autofocus, auto exposure and auto white balance, each where the camera offers it. Each is
 * its own constraint set, so a camera that refuses one still applies the others.
 */
export function automaticControls(controls: CameraControls): MediaTrackConstraintSet[] {
  const sets: Array<Record<string, string>> = [];
  if (controls.focusMode?.includes("continuous")) sets.push({ focusMode: "continuous" });
  if (controls.exposureMode?.includes("continuous")) sets.push({ exposureMode: "continuous" });
  if (controls.whiteBalanceMode?.includes("continuous")) sets.push({ whiteBalanceMode: "continuous" });
  return sets as MediaTrackConstraintSet[];
}

export type LightLevel = "ok" | "low" | "dim";

/** Mean brightness of the picture below which it is "low" and "dim" (0..1, Rec. 709 luma). */
const LOW_LUMA = 0.32;
const DIM_LUMA = 0.2;
/** The level changes only once brightness moves this far past a threshold, so it does not flicker. */
const LIGHT_HYSTERESIS = 0.03;

/** Mean luma (0..1) of RGBA pixels, as read back from a tiny copy of the picture. */
export function meanLuma(rgba: ArrayLike<number>): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    count += 1;
  }
  return count ? sum / count / 255 : 0;
}

/** The room's light from the picture's brightness, keeping the previous level near a threshold. */
export function lightLevel(luma: number, previous: LightLevel = "ok"): LightLevel {
  const dimBelow = previous === "dim" ? DIM_LUMA + LIGHT_HYSTERESIS : DIM_LUMA;
  const lowBelow = previous === "ok" ? LOW_LUMA : LOW_LUMA + LIGHT_HYSTERESIS;
  if (luma < dimBelow) return "dim";
  if (luma < lowBelow) return "low";
  return "ok";
}

/**
 * Raises the camera's exposure compensation by up to one stop in a dim room, where it allows that.
 * Null when it can't, or when the picture is bright enough.
 */
export function exposureLift(controls: CameraControls, current: number | undefined, level: LightLevel): MediaTrackConstraintSet | null {
  const range = controls.exposureCompensation;
  if (level === "ok" || !range || range.max === undefined) return null;
  const base = current ?? 0;
  const step = range.step && range.step > 0 ? range.step : 1 / 3;
  const wanted = Math.min(range.max, base + (level === "dim" ? 1 : 0.5));
  const target = Math.round(wanted / step) * step;
  if (!(target > base)) return null;
  return { exposureCompensation: Number(target.toFixed(3)) } as MediaTrackConstraintSet;
}

/**
 * A gentle lift for the picture on screen in a dim room: brightness and a touch of contrast. It is a
 * GPU filter on the displayed video only; the pose model never sees it.
 */
export function displayFilter(level: LightLevel): string {
  if (level === "dim") return "brightness(1.3) contrast(1.06) saturate(1.05)";
  if (level === "low") return "brightness(1.14) contrast(1.03)";
  return "none";
}
