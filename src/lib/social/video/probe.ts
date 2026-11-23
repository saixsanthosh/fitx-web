/**
 * What this browser can do with video, and what a picked file is (length and frame), read through a <video> element.
 * The pure parts (choosing the recording type) take their browser functions as arguments, so they are tested in Node.
 */
import type { VideoSource } from "./plan";

/** MediaRecorder types that write MP4 with H.264 (and AAC), best first. */
export const MP4_RECORDING_TYPES = [
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4;codecs=\"avc1.42E01F,mp4a.40.2\"",
  "video/mp4;codecs=avc1",
  "video/mp4",
] as const;

/** The first MP4 type MediaRecorder says it can write, or null (Firefox, older browsers: O2 a). */
export function mp4RecordingType(isTypeSupported: ((type: string) => boolean) | null | undefined): string | null {
  if (typeof isTypeSupported !== "function") return null;
  for (const type of MP4_RECORDING_TYPES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // Some browsers throw for a type string they cannot parse: try the next.
    }
  }
  return null;
}

/** This browser's MP4 recording type (null on the server or where MediaRecorder cannot write MP4). */
export function browserMp4Type(): string | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  return mp4RecordingType((type) => MediaRecorder.isTypeSupported(type));
}

/** True when a picked file can be shortened here: canvas capture plus an MP4 MediaRecorder. */
export function canShortenVideo(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas") as HTMLCanvasElement & { captureStream?: unknown };
  return typeof canvas.captureStream === "function" && browserMp4Type() !== null;
}

/** True when the camera can record a clip here. */
export function canRecordCamera(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && browserMp4Type() !== null;
}

/** The length and frame of a picked video. Rejects with "unreadable" when the browser cannot open it. */
export function probeVideo(file: Blob, timeoutMs = 15_000): Promise<VideoSource> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (result: VideoSource | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      if (result) resolve(result);
      else reject(new Error("unreadable"));
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      // A recording without a length in its header reports Infinity until it is seeked to the end.
      if (Number.isFinite(video.duration) && video.duration > 0) {
        finish({ durationMs: Math.round(video.duration * 1000), width: video.videoWidth, height: video.videoHeight });
        return;
      }
      video.ontimeupdate = () => {
        video.ontimeupdate = null;
        finish(Number.isFinite(video.duration) ? { durationMs: Math.round(video.duration * 1000), width: video.videoWidth, height: video.videoHeight } : null);
      };
      video.currentTime = 1e7;
    };
    video.src = url;
  });
}
