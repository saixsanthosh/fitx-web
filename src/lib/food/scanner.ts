/**
 * The pure parts of the barcode scanner: which camera to ask for, how to tune it (continuous focus, zoom, torch,
 * tap to focus), which part of each frame to read, and when a read counts. Kept apart from the component so the
 * tests can run them without a browser.
 */

/** The parts of a camera's capabilities FITX reads (Chrome on Android reports them; Safari reports fewer). */
export interface CameraCapabilities {
  focusMode?: readonly string[];
  zoom?: { min?: number; max?: number; step?: number };
  torch?: boolean;
}

export interface ZoomRange { min: number; max: number; step: number }

export interface CameraTuning {
  /** Constraints to apply once the camera is on; empty when there is nothing to tune. */
  apply: MediaTrackConstraintSet[];
  continuousFocus: boolean;
  /** A tap can set the focus point (needs `pointsOfInterest` and a single-shot or manual focus mode). */
  tapToFocus: boolean;
  zoom: ZoomRange | null;
  /** The zoom the scanner starts at, so a barcode fills the frame from a distance the lens can focus at. */
  startZoom: number | null;
  torch: boolean;
}

/** Retail barcode formats, as the Barcode Detection API names them. */
export const RETAIL_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

/**
 * Asks for the rear camera at high resolution: thin bars need pixels. `ideal` values never fail on a camera that
 * cannot meet them. With a device id (a known main rear camera) that camera is asked for exactly.
 */
export function scannerConstraints(deviceId: string | null = null): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
  };
  // Continuous autofocus where the browser supports it; an unknown advanced constraint is ignored, never an error.
  (video as MediaTrackConstraints & { advanced?: unknown[] }).advanced = [{ focusMode: "continuous" }];
  return { audio: false, video };
}

const REAR = /\b(back|rear|environment)\b/i;
/** Lenses that cannot focus close (ultra-wide, telephoto) or are not for pictures (depth, infrared). */
const NOT_MAIN = /\b(ultra|wide|tele|telephoto|depth|infrared|ir|macro|dual|triple)\b/i;

/**
 * The phone's main rear camera, or null to let the browser pick by `facingMode`. Phones with several rear lenses
 * often hand out the ultra-wide one, which cannot focus on a barcode held close. Labels are only known after the
 * camera was allowed once, so the first scan always lets the browser choose.
 */
export function pickRearCamera(devices: ReadonlyArray<{ deviceId: string; label: string; kind: string }>): string | null {
  const rear = devices.filter((device) => device.kind === "videoinput" && device.deviceId && REAR.test(device.label));
  if (rear.length < 2) return null;
  const main = rear.filter((device) => !NOT_MAIN.test(device.label));
  if (!main.length) return null;
  // Android names them "camera2 0, facing back", "camera2 2, facing back": the lowest number is the main one.
  const index = (label: string) => {
    const match = /camera\d?\s*(\d+)/i.exec(label);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  };
  return [...main].sort((a, b) => index(a.label) - index(b.label))[0].deviceId;
}

/**
 * What the scanner can do with this camera. `supported` is `navigator.mediaDevices.getSupportedConstraints()`;
 * tap to focus needs `pointsOfInterest` there. The starting zoom is 1.5x (or the nearest the lens allows) when the
 * camera zooms to at least 2x: the barcode can then sit a hand's length away, where the lens focuses sharply.
 */
export function cameraTuning(capabilities: CameraCapabilities | null | undefined, supported: Record<string, boolean | undefined> = {}): CameraTuning {
  const caps = capabilities ?? {};
  const modes = Array.isArray(caps.focusMode) ? caps.focusMode : [];
  const continuousFocus = modes.includes("continuous");
  const tapToFocus = Boolean(supported.pointsOfInterest) && (modes.includes("single-shot") || modes.includes("manual") || continuousFocus);
  const zoom = zoomRange(caps.zoom);
  const startZoom = zoom && zoom.max >= 2 ? snapZoom(1.5, zoom) : null;
  const apply: MediaTrackConstraintSet[] = [];
  const advanced: Record<string, unknown> = {};
  if (continuousFocus) advanced.focusMode = "continuous";
  if (startZoom !== null && startZoom !== zoom?.min) advanced.zoom = startZoom;
  if (Object.keys(advanced).length) apply.push(advanced as MediaTrackConstraintSet);
  return { apply, continuousFocus, tapToFocus, zoom, startZoom, torch: caps.torch === true };
}

function zoomRange(value: CameraCapabilities["zoom"]): ZoomRange | null {
  const min = Number(value?.min);
  const max = Number(value?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || min <= 0) return null;
  const step = Number(value?.step);
  return { min, max, step: Number.isFinite(step) && step > 0 ? step : 0.1 };
}

/** A zoom level inside the camera's range, on its step. */
export function snapZoom(value: number, range: ZoomRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  const steps = Math.round((clamped - range.min) / range.step);
  return Math.round((range.min + steps * range.step) * 100) / 100;
}

/** The focus constraint for a tap: the point first, then a single focus pass there (or manual where that is all there is). */
export function focusConstraints(point: { x: number; y: number }, modes: readonly string[] = []): MediaTrackConstraintSet {
  const focusMode = modes.includes("single-shot") ? "single-shot" : modes.includes("continuous") ? "continuous" : "manual";
  return { pointsOfInterest: [point], focusMode } as unknown as MediaTrackConstraintSet;
}

type Box = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };

/**
 * Where on the camera frame a tap landed, from 0 to 1 on each side. The preview fills its box with
 * `object-fit: cover`, so part of the frame is cut off and the tap is mapped through that crop.
 */
export function focusPoint(tap: { x: number; y: number }, box: Box, frame: Size): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const scale = Math.max(box.width / frame.width, box.height / frame.height);
  const shownWidth = frame.width * scale;
  const shownHeight = frame.height * scale;
  const x = (tap.x - box.left + (shownWidth - box.width) / 2) / shownWidth;
  const y = (tap.y - box.top + (shownHeight - box.height) / 2) / shownHeight;
  const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
  return { x: clamp(x), y: clamp(y) };
}

/** The scan window as fractions of the preview box: a wide band through the middle, as barcodes are wide. */
export const SCAN_WINDOW = { left: 0.08, right: 0.08, top: 0.28, bottom: 0.28 } as const;

/**
 * The part of the camera frame under the scan window, in frame pixels, with a margin so a barcode that overhangs
 * the window a little still reads. Reading only this part is faster and ignores other codes in view. Null when the
 * sizes are not known yet (the whole frame is read then).
 */
export function scanRegion(frame: Size, view: Size, area: { left: number; right: number; top: number; bottom: number } = SCAN_WINDOW, margin = 0.06):
  { x: number; y: number; width: number; height: number } | null {
  if (frame.width <= 0 || frame.height <= 0 || view.width <= 0 || view.height <= 0) return null;
  const scale = Math.max(view.width / frame.width, view.height / frame.height);
  const offsetX = (frame.width * scale - view.width) / 2;
  const offsetY = (frame.height * scale - view.height) / 2;
  const toFrameX = (viewX: number) => (viewX + offsetX) / scale;
  const toFrameY = (viewY: number) => (viewY + offsetY) / scale;
  const left = Math.max(0, toFrameX(view.width * Math.max(0, area.left - margin)));
  const right = Math.min(frame.width, toFrameX(view.width * (1 - Math.max(0, area.right - margin))));
  const top = Math.max(0, toFrameY(view.height * Math.max(0, area.top - margin)));
  const bottom = Math.min(frame.height, toFrameY(view.height * (1 - Math.max(0, area.bottom - margin))));
  if (right - left < 8 || bottom - top < 8) return null;
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

export type ReadState = "searching" | "steady" | "confirmed";

/**
 * When a read counts: the same valid code `need` times within `windowMs`, so one misread frame never looks a
 * product up. A different code starts over. `state(now)` drops back to "searching" once reads stop arriving.
 */
export function createReadConsensus(need = 2, windowMs = 1500) {
  let code = "";
  let count = 0;
  let firstAt = 0;
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    push(next: string, now: number): { state: ReadState; code: string } {
      if (next !== code || now - firstAt > windowMs) {
        code = next;
        count = 0;
        firstAt = now;
      }
      count += 1;
      lastAt = now;
      return { state: count >= need ? "confirmed" : "steady", code };
    },
    state(now: number): ReadState {
      if (!code || now - lastAt > 700) return "searching";
      return count >= need ? "confirmed" : "steady";
    },
    reset() {
      code = "";
      count = 0;
      firstAt = 0;
      lastAt = Number.NEGATIVE_INFINITY;
    },
  };
}

/** What the scanner says under the preview for each read state. */
export function readStateText(state: ReadState): string {
  if (state === "confirmed") return "Got it. Looking it up…";
  if (state === "steady") return "Hold steady…";
  return "Line the barcode up inside the frame.";
}

/** Why the camera did not start, in plain words, always with the way forward. */
export function cameraProblem(name: string): string {
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access is blocked. Allow it in your browser settings, or type the number.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found. Use a photo, or type the number.";
  if (name === "NotReadableError") return "Another app is using the camera. Close it and try again, or type the number.";
  return "The camera could not start. Use a photo, or type the number.";
}
