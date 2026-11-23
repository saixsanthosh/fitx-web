/**
 * Camera access for the form coach. Video stays in this browser: the stream only feeds the
 * on-device pose model and is never recorded or uploaded.
 */
import { captureConstraints } from "./capture";

export type CameraProblem = "insecure" | "unsupported" | "denied" | "no-camera" | "busy" | "constraints" | "interrupted" | "unknown";

export type Platform = "ios" | "android" | "other";

export class CameraError extends Error {
  readonly problem: CameraProblem;

  constructor(problem: CameraProblem, cause?: unknown) {
    super(`camera: ${problem}`, cause === undefined ? undefined : { cause });
    this.name = "CameraError";
    this.problem = problem;
  }
}

/** Maps a getUserMedia failure to a problem the user can act on. */
export function cameraProblemFromError(error: unknown): CameraProblem {
  if (error instanceof CameraError) return error.problem;
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "no-camera";
    case "NotReadableError":
    case "TrackStartError":
      return "busy";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "constraints";
    case "AbortError":
      return "interrupted";
    default:
      return "unknown";
  }
}

export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

export interface CameraHelp {
  title: string;
  body: string;
}

/** What went wrong and what to do about it, in plain words. */
export function cameraHelp(problem: CameraProblem, platform: Platform): CameraHelp {
  switch (problem) {
    case "insecure":
      return { title: "The camera needs a secure connection", body: "Open FITX from its https address to use the camera coach." };
    case "unsupported":
      return { title: "This browser can't use the camera", body: "Open FITX in an up-to-date Safari or Chrome to use the camera coach." };
    case "denied":
      return {
        title: "Camera access is off for FITX",
        body: platform === "ios"
          ? "In Safari, tap the page settings button in the address bar, open Website Settings, set Camera to Allow, then try again."
          : platform === "android"
            ? "In Chrome, tap the icon at the left of the address bar, open Permissions, allow Camera, then try again."
            : "Allow the camera for this site from the icon in your browser's address bar, then try again.",
      };
    case "no-camera":
      return { title: "No camera found", body: "Connect a camera, or open FITX on your phone." };
    case "busy":
      return { title: "The camera is busy", body: "Another app or tab is using it. Close video calls or the camera app, then try again." };
    case "constraints":
      return { title: "This camera couldn't start", body: "Try the other camera, or try again." };
    case "interrupted":
      return { title: "The camera stopped", body: "It was interrupted, perhaps by a call or another app. Try again." };
    default:
      return { title: "The camera couldn't start", body: "Try again. If it keeps happening, close and reopen the browser." };
  }
}

export interface CameraRequest {
  facing: "user" | "environment";
  width: number;
  height: number;
  frameRate: number;
  /** A specific camera, when switching between several. */
  deviceId?: string;
}

/** Opens the camera (video only). Throws CameraError. */
export async function openCamera(request: CameraRequest): Promise<MediaStream> {
  if (typeof window === "undefined" || !window.isSecureContext) throw new CameraError("insecure");
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new CameraError("unsupported");
  const video = captureConstraints(request);
  try {
    return await devices.getUserMedia({ audio: false, video });
  } catch (error) {
    if (cameraProblemFromError(error) !== "constraints") throw new CameraError(cameraProblemFromError(error), error);
    try {
      return await devices.getUserMedia({ audio: false, video: true });
    } catch (retry) {
      throw new CameraError(cameraProblemFromError(retry), retry);
    }
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** "denied" lets the page explain how to re-enable the camera before asking again; "unknown" where the browser can't tell. */
export async function cameraPermission(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions?.query({ name: "camera" as PermissionName });
    return status?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Video inputs on this device (labels are only filled in after permission is granted). */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  try {
    const all = await navigator.mediaDevices?.enumerateDevices();
    return (all ?? []).filter((device) => device.kind === "videoinput");
  } catch {
    return [];
  }
}
