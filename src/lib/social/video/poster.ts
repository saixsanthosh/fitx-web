/**
 * A video's poster: one frame drawn to a canvas and encoded as WebP (JPEG where the browser cannot write WebP, such as
 * Safari; it is still stored at `<n>p.webp`, with its real type, so browsers show it either way). Grids, tiles and
 * cards show the poster, never the video, so a poster costs no play budget.
 */
import { QUALITY_STEPS } from "../compress";
import { frameSize } from "./plan";

/** A poster stays small: it is fetched for every tile and card that shows the video. */
export const POSTER_LONG_EDGE = 1080;
export const POSTER_MAX_BYTES = 400 * 1024;

export type Poster = { blob: Blob; type: "image/webp" | "image/jpeg"; width: number; height: number };

/** The poster size for a frame: the long edge at most 1,080 px. */
export function posterSize(width: number, height: number): { width: number; height: number } {
  return frameSize(width, height, POSTER_LONG_EDGE);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Encodes the video element's current frame. */
export async function posterFromElement(video: HTMLVideoElement): Promise<Poster> {
  const size = posterSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no_poster");
  context.drawImage(video, 0, 0, size.width, size.height);
  for (const type of ["image/webp", "image/jpeg"] as const) {
    for (const quality of QUALITY_STEPS) {
      const blob = await toBlob(canvas, type, quality);
      if (!blob || blob.type !== type) break;
      if (blob.size <= POSTER_MAX_BYTES) return { blob, type, ...size };
    }
  }
  throw new Error("no_poster");
}

/** Opens `clip`, seeks to `atMs` (or a little in, so the first frame is never black) and encodes that frame. */
export async function posterFromClip(clip: Blob, atMs = 400): Promise<Poster> {
  const url = URL.createObjectURL(clip);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("no_poster")), 15_000);
      video.onerror = () => { window.clearTimeout(timer); reject(new Error("no_poster")); };
      video.onloadeddata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        video.onseeked = () => { window.clearTimeout(timer); resolve(); };
        video.currentTime = Math.min(atMs / 1000, Math.max(0, duration - 0.05));
      };
      video.src = url;
    });
    return await posterFromElement(video);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
