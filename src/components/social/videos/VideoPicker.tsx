"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Camera, CircleStop, Film, Loader2, RotateCcw, Video } from "lucide-react";
import { SOCIAL_LIMITS } from "@/lib/social";
import { sniffMp4, type Mp4Info } from "@/lib/social/video/mp4-sniff";
import {
  clock, latestStart, passThroughOk, planVideo, retryPlan, storedDuration, VIDEO_LIMITS, videoProblem, type VideoSource, type VideoTarget,
} from "@/lib/social/video/plan";
import { posterFromClip, type Poster } from "@/lib/social/video/poster";
import { canRecordCamera, canShortenVideo, probeVideo } from "@/lib/social/video/probe";
import { CAMERA_CONSTRAINTS, recordStream, shortenVideo } from "@/lib/social/video/record";
import styles from "./Videos.module.css";

/** A clip ready to upload: an MP4 within the place's length and the bucket limit, with its poster. */
export type PreparedVideo = { blob: Blob; poster: Poster; width: number; height: number; durationMs: number; url: string };

type Stage =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "trim"; file: File; source: VideoSource }
  | { kind: "preparing"; share: number }
  | { kind: "camera"; stream: MediaStream; recording: { stop: () => void; startedAt: number } | null }
  | { kind: "ready"; video: PreparedVideo };

const noSubscribe = () => () => undefined;
let known: { shorten: boolean; camera: boolean } | null = null;
const NONE = { shorten: false, camera: false };
/** What this browser can do (fixed for the page's life); nothing on the server. */
function useAbilities() {
  return useSyncExternalStore(noSubscribe, () => (known ??= { shorten: canShortenVideo(), camera: canRecordCamera() }), () => NONE);
}

/** Reads `blob` as an MP4 and checks it fits; null when it does not (with the reason). */
async function checkMp4(blob: Blob, target: VideoTarget): Promise<{ info: Mp4Info } | { reason: string }> {
  if (blob.size > VIDEO_LIMITS.fileBytes) return { reason: "too_large" };
  const sniff = sniffMp4(new Uint8Array(await blob.arrayBuffer()));
  if (!sniff.ok) return { reason: "not_mp4" };
  const fit = passThroughOk(sniff.info, blob.size, target);
  // A clip made here at the plan's size always fits the frame rule; only length and size matter for it.
  if (!fit.ok && fit.reason !== "frame") return { reason: fit.reason };
  return { info: sniff.info };
}

/**
 * Picking or recording a short video, made to fit on this device (wave-2 brief 3.10): a file that is already a small
 * H.264 MP4 goes up as it is; any other is replayed into a canvas and recorded as MP4 at the plan's size and rates
 * (one retry at a lower rate if it comes out too large); the camera records straight to MP4. Browsers that cannot
 * write MP4 (Firefox) say so (O2 a). Nothing is uploaded here.
 */
export function VideoPicker({ target, onChange, disabled = false }: { target: VideoTarget; onChange: (video: PreparedVideo | null) => void; disabled?: boolean }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [startMs, setStartMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abilities = useAbilities();
  const preview = useRef<HTMLVideoElement>(null);
  const live = useRef<HTMLVideoElement>(null);
  const abort = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const max = VIDEO_LIMITS.maxMs[target];

  const stopCamera = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  useEffect(() => () => {
    abort.current?.abort();
    stopCamera();
    for (const url of urls.current) URL.revokeObjectURL(url);
  }, [stopCamera]);

  const fail = useCallback((reason: string) => {
    setError(videoProblem(reason, target));
    setStage({ kind: "idle" });
    onChange(null);
  }, [onChange, target]);

  const finish = useCallback(async (blob: Blob, fallback: { width: number; height: number; durationMs: number }) => {
    const checked = await checkMp4(blob, target);
    if ("reason" in checked) return checked.reason;
    const poster = await posterFromClip(blob);
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    const video: PreparedVideo = {
      blob, poster, url,
      width: checked.info.video?.width || fallback.width,
      height: checked.info.video?.height || fallback.height,
      durationMs: storedDuration(checked.info.durationMs ?? fallback.durationMs, target),
    };
    setStage({ kind: "ready", video });
    onChange(video);
    return null;
  }, [onChange, target]);

  async function pick(file: File) {
    setError(null);
    onChange(null);
    if (file.size > VIDEO_LIMITS.sourceBytes) return fail("source_too_large");
    setStage({ kind: "reading" });
    let source: VideoSource;
    try {
      source = await probeVideo(file);
    } catch {
      return fail("unreadable");
    }
    const planned = planVideo(source, target);
    if (!planned.ok) return fail(planned.reason);
    // An MP4 that already fits goes up as it is (no re-encode, no waiting).
    if (file.size <= VIDEO_LIMITS.fileBytes && (file.type === "video/mp4" || /\.mp4$/i.test(file.name))) {
      const sniff = sniffMp4(new Uint8Array(await file.arrayBuffer()));
      if (sniff.ok && passThroughOk(sniff.info, file.size, target).ok) {
        try {
          const problem = await finish(file, { ...source });
          if (!problem) return;
        } catch {
          // Fall through to shortening it.
        }
      }
    }
    if (!abilities.shorten) return fail("no_recorder");
    setStartMs(0);
    setStage({ kind: "trim", file, source });
  }

  async function prepare(file: File, source: VideoSource) {
    const planned = planVideo(source, target, startMs);
    if (!planned.ok) return fail(planned.reason);
    const controller = new AbortController();
    abort.current = controller;
    setStage({ kind: "preparing", share: 0 });
    try {
      let plan = planned.plan;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const blob = await shortenVideo(file, plan, { signal: controller.signal, onProgress: (share) => setStage({ kind: "preparing", share }) });
        const problem = await finish(blob, { width: plan.width, height: plan.height, durationMs: plan.durationMs });
        if (!problem) return;
        if (problem !== "too_large" || attempt === 1) return fail(problem);
        plan = retryPlan(plan);
      }
    } catch (failure) {
      if ((failure as Error)?.name === "AbortError") return;
      fail(failure instanceof Error ? failure.message : "failed");
    } finally {
      abort.current = null;
    }
  }

  async function openCamera() {
    setError(null);
    onChange(null);
    try {
      // Without a microphone (or its permission) the clip is recorded without sound rather than not at all.
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
        .catch(() => navigator.mediaDevices.getUserMedia({ ...CAMERA_CONSTRAINTS, audio: false }));
      streamRef.current = stream;
      setStage({ kind: "camera", stream, recording: null });
    } catch {
      fail("camera");
    }
  }

  useEffect(() => {
    if (stage.kind === "camera" && live.current && live.current.srcObject !== stage.stream) {
      live.current.srcObject = stage.stream;
      void live.current.play().catch(() => undefined);
    }
  }, [stage]);

  useEffect(() => {
    if (stage.kind !== "camera" || !stage.recording) return;
    const started = stage.recording.startedAt;
    const timer = window.setInterval(() => setElapsed(Math.min(max, performance.now() - started)), 200);
    return () => window.clearInterval(timer);
  }, [max, stage]);

  function startRecording() {
    if (stage.kind !== "camera") return;
    const recording = recordStream(stage.stream, max, { videoBitsPerSecond: VIDEO_LIMITS.videoBitsPerSecond, audioBitsPerSecond: VIDEO_LIMITS.audioBitsPerSecond });
    setElapsed(0);
    setStage({ ...stage, recording });
    const settings = stage.stream.getVideoTracks()[0]?.getSettings() ?? {};
    void recording.done.then(async ({ blob, elapsedMs }) => {
      stopCamera();
      if (elapsedMs < VIDEO_LIMITS.minMs) return fail("too_short");
      setStage({ kind: "preparing", share: 1 });
      try {
        const problem = await finish(blob, { width: settings.width ?? 1280, height: settings.height ?? 720, durationMs: elapsedMs });
        if (problem) fail(problem);
      } catch {
        fail("failed");
      }
    }).catch(() => fail("failed"));
  }

  function reset() {
    abort.current?.abort();
    stopCamera();
    setStage({ kind: "idle" });
    setError(null);
    onChange(null);
  }

  const canChoose = stage.kind === "idle" && !disabled;
  return (
    <div className={styles.picker}>
      {stage.kind === "idle" && (
        <div className={styles.choices}>
          <label className={styles.choice} aria-disabled={!canChoose}>
            <span className={styles.choiceIcon} aria-hidden="true"><Film size={22} /></span>
            <span className={styles.choiceText}>
              <span className={styles.choiceLabel}>Choose a video</span>
              <span className={styles.choiceHint}>Up to {max / 1000} seconds. Made smaller on your device first.</span>
            </span>
            <input type="file" accept="video/mp4,video/quicktime,video/webm,video/*" className="sr-only" aria-label="Choose a video" disabled={!canChoose}
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void pick(file); }} />
          </label>
          {abilities.camera && (
            <button type="button" className={styles.choice} onClick={() => void openCamera()} disabled={!canChoose}>
              <span className={styles.choiceIcon} aria-hidden="true"><Camera size={22} /></span>
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>Record with the camera</span>
                <span className={styles.choiceHint}>Stops by itself at {max / 1000} seconds.</span>
              </span>
            </button>
          )}
        </div>
      )}

      {stage.kind === "reading" && (
        <p className={styles.status} role="status"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Opening the video</p>
      )}

      {stage.kind === "trim" && (
        <div className={styles.panel}>
          <p className={styles.panelText}>
            <Video size={18} aria-hidden="true" />
            {stage.source.durationMs > max
              ? `This video is ${clock(stage.source.durationMs)}. Choose where its ${max / 1000} seconds start.`
              : `This video is ${clock(stage.source.durationMs)}. It is made smaller on your device before it is shared.`}
          </p>
          {stage.source.durationMs > max && (
            <div className={styles.trim}>
              <label htmlFor="video-start" className={styles.trimLabel}>Start at {clock(startMs)}</label>
              <input id="video-start" type="range" min={0} max={latestStart(stage.source.durationMs, target)} step={250} value={startMs}
                onChange={(event) => setStartMs(Number(event.target.value))} className={styles.range} />
              <span className={styles.trimHint} aria-hidden="true">{clock(startMs)} to {clock(Math.min(stage.source.durationMs, startMs + max))}</span>
            </div>
          )}
          <div className={styles.row}>
            <button type="button" className="fitx-button" onClick={() => void prepare(stage.file, stage.source)}>Prepare video</button>
            <button type="button" className="fitx-button fitx-button-secondary" onClick={reset}>Choose another</button>
          </div>
        </div>
      )}

      {stage.kind === "preparing" && (
        <div className={styles.panel}>
          <p className={styles.status} role="status"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Preparing the video. This takes about as long as the clip.</p>
          <div className={styles.progress} role="progressbar" aria-label="Preparing the video" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stage.share * 100)}>
            <div className={styles.progressBar} style={{ transform: `scaleX(${stage.share})` }} />
          </div>
          <button type="button" className="fitx-button fitx-button-secondary self-start" onClick={reset}>Cancel</button>
        </div>
      )}

      {stage.kind === "camera" && (
        <div className={styles.panel}>
          <div className={styles.cameraFrame}>
            <video ref={live} className={styles.cameraVideo} muted playsInline aria-label="Camera preview" />
            {stage.recording && <span className={styles.recordBadge} role="status"><span className={styles.recordDot} aria-hidden="true" />{clock(elapsed)} of {clock(max)}</span>}
          </div>
          <div className={styles.row}>
            {stage.recording ? (
              <button type="button" className="fitx-button" onClick={stage.recording.stop}><CircleStop size={17} aria-hidden="true" />Stop recording</button>
            ) : (
              <button type="button" className="fitx-button" onClick={startRecording}><span className={styles.recordDot} aria-hidden="true" />Start recording</button>
            )}
            <button type="button" className="fitx-button fitx-button-secondary" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {stage.kind === "ready" && (
        <div className={styles.panel}>
          <video ref={preview} className={styles.ready} src={stage.video.url} controls playsInline muted preload="metadata" aria-label="Your video" />
          <p className={styles.readyMeta}>{clock(stage.video.durationMs)} · {(stage.video.blob.size / (1024 * 1024)).toFixed(1)} MB of {Math.round(SOCIAL_LIMITS.fileBytes / (1024 * 1024))} MB</p>
          <button type="button" className="fitx-button fitx-button-secondary self-start" onClick={reset} disabled={disabled}><RotateCcw size={16} aria-hidden="true" />Choose another</button>
        </div>
      )}

      {error && <p className={styles.alert} role="alert">{error}</p>}
    </div>
  );
}
