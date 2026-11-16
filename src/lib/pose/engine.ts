/**
 * MediaPipe Pose Landmarker, running entirely in this browser. Camera frames go into the
 * WebAssembly model on the device and only the 33 landmark positions come out; nothing is sent
 * anywhere. Loaded on demand, so pages without the camera coach never download it.
 */
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { POSE_ASSETS } from "./assets";
import type { PosePoint } from "./landmarks";
import type { ModelVariant } from "./performance";

export type EngineProblem = "unsupported" | "download" | "start" | "runtime";

export class PoseEngineError extends Error {
  readonly problem: EngineProblem;

  constructor(problem: EngineProblem, cause?: unknown) {
    super(`pose engine: ${problem}`, cause === undefined ? undefined : { cause });
    this.name = "PoseEngineError";
    this.problem = problem;
  }
}

export interface PoseEngine {
  readonly variant: ModelVariant;
  readonly delegate: "GPU" | "CPU";
  /** Landmarks of the most prominent person in this video frame, or null. `timestampMs` must increase. */
  detect(video: HTMLVideoElement, timestampMs: number): PosePoint[] | null;
  close(): void;
}

export interface EngineOptions {
  variant: ModelVariant;
  /** "auto" tries the GPU first and falls back to the CPU. */
  delegate?: "auto" | "CPU";
  /** Download progress, 0..1. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** After this many failed frames in a row the engine reports a runtime problem (e.g. a lost GPU context). */
const MAX_FAILED_FRAMES = 5;

export async function createPoseEngine(options: EngineOptions): Promise<PoseEngine> {
  let vision: typeof import("@mediapipe/tasks-vision");
  try {
    vision = await import("@mediapipe/tasks-vision");
  } catch (error) {
    throw new PoseEngineError("download", error);
  }
  if (!(await vision.FilesetResolver.isSimdSupported())) throw new PoseEngineError("unsupported");
  checkAborted(options.signal);

  const model = POSE_ASSETS.models[options.variant];
  const total = POSE_ASSETS.wasmBytes + model.bytes;
  let received = 0;
  const onBytes = (count: number) => {
    received += count;
    options.onProgress?.(Math.min(1, received / total));
  };
  // Reading the runtime here shows real progress; MediaPipe's own request then comes from the browser cache.
  const [, modelBytes] = await Promise.all([
    download(POSE_ASSETS.wasmBinary, onBytes, options.signal),
    download(model.path, onBytes, options.signal),
  ]);
  checkAborted(options.signal);
  options.onProgress?.(1);

  const fileset = { wasmLoaderPath: POSE_ASSETS.wasmLoader, wasmBinaryPath: POSE_ASSETS.wasmBinary };
  const delegates: Array<"GPU" | "CPU"> = options.delegate === "CPU" ? ["CPU"] : ["GPU", "CPU"];
  let lastError: unknown;
  for (const delegate of delegates) {
    try {
      const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: modelBytes.slice(), delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      if (options.signal?.aborted) {
        landmarker.close();
        checkAborted(options.signal);
      }
      return wrap(landmarker, options.variant, delegate);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw new PoseEngineError("start", lastError);
}

function wrap(landmarker: PoseLandmarker, variant: ModelVariant, delegate: "GPU" | "CPU"): PoseEngine {
  let failures = 0;
  let closed = false;
  return {
    variant,
    delegate,
    detect(video, timestampMs) {
      if (closed) return null;
      try {
        const result = landmarker.detectForVideo(video, timestampMs);
        failures = 0;
        const person = result.landmarks[0];
        // 0.10.x reports each landmark's visibility; a separate presence score only exists in later versions.
        return person ? person.map((point) => ({ x: point.x, y: point.y, z: point.z, visibility: point.visibility })) : null;
      } catch (error) {
        failures += 1;
        if (failures >= MAX_FAILED_FRAMES) throw new PoseEngineError("runtime", error);
        return null;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        landmarker.close();
      } catch {
        // Already released with its WebGL context.
      }
    },
  };
}

async function download(url: string, onBytes: (count: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: "same-origin" });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new PoseEngineError("download", error);
  }
  if (!response.ok || !response.body) throw new PoseEngineError("download", new Error(`${url}: HTTP ${response.status}`));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      onBytes(value.byteLength);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new PoseEngineError("download", error);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("The camera coach was closed.", "AbortError");
}

// ---------------------------------------------------------------------------------------------
// One shared engine, so counting set after set (or switching exercises) does not reload the model.

interface PoolEntry {
  key: string;
  ready: Promise<PoseEngine>;
  progress: number;
  listeners: Set<(fraction: number) => void>;
  users: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
}

let pool: PoolEntry | null = null;
/** An unused engine is closed after this long, freeing its memory. */
const IDLE_CLOSE_MS = 120_000;

export interface EngineLease {
  ready: Promise<PoseEngine>;
  /** Hands the engine back; it stays warm for two minutes in case another set follows. */
  release(): void;
}

/** Borrows the shared engine for this model and delegate, creating it on first use. */
export function acquirePoseEngine(variant: ModelVariant, delegate: "auto" | "CPU", onProgress?: (fraction: number) => void): EngineLease {
  const key = `${variant}:${delegate}`;
  if (pool && pool.key !== key && pool.users === 0) disposePool();
  if (!pool || pool.key !== key) {
    const entry: PoolEntry = { key, progress: 0, listeners: new Set(), users: 0, closeTimer: null, ready: Promise.resolve(null as unknown as PoseEngine) };
    entry.ready = createPoseEngine({
      variant,
      delegate,
      onProgress: (fraction) => {
        entry.progress = fraction;
        entry.listeners.forEach((listener) => listener(fraction));
      },
    });
    entry.ready.catch(() => {
      if (pool === entry) pool = null;
    });
    pool = entry;
  }
  const entry = pool;
  entry.users += 1;
  if (entry.closeTimer) {
    clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
  }
  if (onProgress) {
    entry.listeners.add(onProgress);
    onProgress(entry.progress);
  }
  let released = false;
  return {
    ready: entry.ready,
    release() {
      if (released) return;
      released = true;
      if (onProgress) entry.listeners.delete(onProgress);
      entry.users -= 1;
      if (entry.users > 0) return;
      if (pool !== entry) {
        void entry.ready.then((engine) => engine.close(), () => undefined);
        return;
      }
      entry.closeTimer = setTimeout(() => {
        if (pool === entry && entry.users === 0) disposePool();
      }, IDLE_CLOSE_MS);
    },
  };
}

/** Drops the shared engine (after a GPU failure) so the next lease starts a fresh one. */
export function discardPoseEngine(engine: PoseEngine): void {
  const entry = pool;
  if (!entry) return;
  void entry.ready.then((current) => {
    if (current === engine && pool === entry) pool = null;
  }, () => undefined);
}

function disposePool() {
  const entry = pool;
  pool = null;
  if (!entry) return;
  if (entry.closeTimer) clearTimeout(entry.closeTimer);
  void entry.ready.then((engine) => engine.close(), () => undefined);
}
