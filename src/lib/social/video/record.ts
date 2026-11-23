/**
 * Re-encoding in the browser (wave-2 brief 3.10), with no package: the picked file plays into a canvas at the plan's
 * size, `canvas.captureStream(30)` takes the frames and Web Audio the sound (routed only to the recorder, so nothing is
 * heard), and MediaRecorder writes MP4. Camera clips record the camera stream straight into MediaRecorder.
 * Browser only. HTMLMediaElement.captureStream is not used: Safari does not have it.
 */
import { browserMp4Type } from "./probe";
import type { VideoPlan } from "./plan";

export type RecordOptions = { onProgress?: (share: number) => void; signal?: AbortSignal };

type CanvasWithCapture = HTMLCanvasElement & { captureStream(fps?: number): MediaStream };
type VideoWithFrames = HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number };
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

function abortError() {
  return new DOMException("The video was not finished.", "AbortError");
}

function once(target: EventTarget, event: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(abortError()); };
    const cleanup = () => { target.removeEventListener(event, done); signal?.removeEventListener("abort", fail); };
    target.addEventListener(event, done, { once: true });
    signal?.addEventListener("abort", fail, { once: true });
  });
}

/** Collects a MediaRecorder's output as one MP4 blob once it stops. */
function collect(recorder: MediaRecorder): Promise<Blob> {
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
  return new Promise((resolve, reject) => {
    recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: "video/mp4" })), { once: true });
    recorder.addEventListener("error", () => reject(new Error("record_failed")), { once: true });
  });
}

/**
 * Plays `file` from `plan.startMs` for `plan.durationMs` into a canvas and records it as MP4 at the plan's rates. Takes
 * as long as the clip (it records in real time). Rejects with an AbortError when `signal` aborts.
 */
export async function shortenVideo(file: Blob, plan: VideoPlan, { onProgress, signal }: RecordOptions = {}): Promise<Blob> {
  const mimeType = browserMp4Type();
  if (!mimeType) throw new Error("no_recorder");
  const url = URL.createObjectURL(file);
  const video = document.createElement("video") as VideoWithFrames;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  const canvas = document.createElement("canvas") as CanvasWithCapture;
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no_recorder");
  const AudioCtor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  let audio: AudioContext | null = null;
  let stopped = false;
  try {
    if (video.readyState < 1) await once(video, "loadedmetadata", signal);
    video.currentTime = plan.startMs / 1000;
    await once(video, "seeked", signal);
    const stream = canvas.captureStream(plan.fps);
    if (AudioCtor) {
      try {
        audio = new AudioCtor();
        const source = audio.createMediaElementSource(video);
        const destination = audio.createMediaStreamDestination();
        // Only to the recorder: the member hears nothing while it records.
        source.connect(destination);
        for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
      } catch {
        audio = null;
      }
    }
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: plan.videoBitsPerSecond, audioBitsPerSecond: plan.audioBitsPerSecond });
    const output = collect(recorder);
    const endAt = (plan.startMs + plan.durationMs) / 1000;
    const draw = () => {
      if (stopped) return;
      context.drawImage(video, 0, 0, plan.width, plan.height);
      onProgress?.(Math.min(1, Math.max(0, (video.currentTime - plan.startMs / 1000) / (plan.durationMs / 1000))));
      if (video.currentTime >= endAt || video.ended) {
        stop();
        return;
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw);
      else requestAnimationFrame(draw);
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      video.pause();
      if (recorder.state !== "inactive") recorder.stop();
      for (const track of stream.getTracks()) track.stop();
    };
    signal?.addEventListener("abort", stop, { once: true });
    video.addEventListener("ended", stop, { once: true });
    context.drawImage(video, 0, 0, plan.width, plan.height);
    recorder.start(1000);
    try {
      await video.play();
    } catch {
      // Sound needs a tap on some browsers: record the picture alone rather than fail.
      video.muted = true;
      await video.play();
    }
    draw();
    const blob = await output;
    if (signal?.aborted) throw abortError();
    onProgress?.(1);
    return blob;
  } finally {
    stopped = true;
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    void audio?.close().catch(() => undefined);
  }
}

/** The camera constraints for a clip: a front camera at about 720p, with sound. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
  audio: true,
};

/**
 * Records `stream` (the camera) as MP4 until `stop()` or `maxMs`. The caller owns the stream and stops its tracks.
 * `done` settles with the clip and its length as measured here.
 */
export function recordStream(stream: MediaStream, maxMs: number, rates: { videoBitsPerSecond: number; audioBitsPerSecond: number }) {
  const mimeType = browserMp4Type();
  if (!mimeType) throw new Error("no_recorder");
  const recorder = new MediaRecorder(stream, { mimeType, ...rates });
  const output = collect(recorder);
  const started = performance.now();
  const timer = window.setTimeout(() => stop(), maxMs);
  const stop = () => {
    window.clearTimeout(timer);
    if (recorder.state !== "inactive") recorder.stop();
  };
  recorder.start(1000);
  const done = output.then((blob) => ({ blob, elapsedMs: Math.min(maxMs, Math.round(performance.now() - started)) }));
  return { stop, done, startedAt: started };
}
