/**
 * Main-thread character loader. OWNER: character-body.
 *
 * Generation runs in a small pool of module workers (up to 3, fewer on low-core devices); results
 * are cached at module level so "Replay intro" assembles instantly. Queued jobs run in cast order
 * and the opening character (Maya) runs alone — the other workers are already spawned and loading
 * but get no job until she is done, so the first frame is not slowed by contention. If workers
 * cannot start or fail, generation falls back to the main thread through a dynamic import of
 * `generate.ts` (slower, but the film still plays).
 */

import { CAST_ORDER } from "./cast";
import type { CharacterWorkerRequest, CharacterWorkerResponse } from "./character.worker";
import type { CharacterId, CharacterMeshData } from "./types";

interface Job {
  id: CharacterId;
  resolve: (data: CharacterMeshData) => void;
  reject: (error: Error) => void;
}

interface PoolWorker {
  worker: Worker;
  job: Job | null;
}

const cache = new Map<CharacterId, Promise<CharacterMeshData>>();
const ready = new Map<CharacterId, CharacterMeshData>();
const queue: Job[] = [];
let pool: PoolWorker[] = [];
let workersFailed = false;
/** While the opening character generates, other jobs wait (they would steal ~20% of its CPU). */
let exclusive: CharacterId | null = null;
/** Set by `releaseCharacterWorkers`: finish what is in flight, then terminate the idle pool. */
let releasing = false;

function poolSize(): number {
  const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return cores >= 8 ? 3 : cores >= 4 ? 2 : 1;
}

function priority(id: CharacterId) {
  const index = CAST_ORDER.indexOf(id);
  return index < 0 ? CAST_ORDER.length : index;
}

async function generateOnMainThread(id: CharacterId): Promise<CharacterMeshData> {
  // Yield first so callers get their promise before the (blocking) generation starts.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const [{ generateCharacter }, { CAST }] = await Promise.all([import("./generate"), import("./cast")]);
  return generateCharacter(CAST[id]);
}

function runOnMainThread(job: Job) {
  generateOnMainThread(job.id).then(job.resolve, (error: unknown) => job.reject(error instanceof Error ? error : new Error(String(error))));
}

/** Gives up on workers: in-flight and queued jobs move to the main thread. */
function failWorkers(reason: string) {
  if (!workersFailed && typeof console !== "undefined") console.warn(`[fitx] character workers unavailable (${reason}); generating on the main thread`);
  workersFailed = true;
  exclusive = null;
  const orphans: Job[] = [];
  for (const entry of pool) {
    if (entry.job) orphans.push(entry.job);
    entry.worker.terminate();
  }
  pool = [];
  orphans.push(...queue.splice(0));
  orphans.sort((a, b) => priority(a.id) - priority(b.id));
  for (const job of orphans) runOnMainThread(job);
}

function createPoolWorker(): PoolWorker | null {
  if (workersFailed || typeof Worker === "undefined") return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./character.worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    failWorkers(error instanceof Error ? error.message : String(error));
    return null;
  }
  const entry: PoolWorker = { worker, job: null };
  worker.onmessage = (event: MessageEvent<CharacterWorkerResponse>) => {
    const message = event.data;
    const job = entry.job;
    entry.job = null;
    if (job && message.id === job.id) {
      if (exclusive === job.id) exclusive = null;
      if (message.type === "result") job.resolve(message.data);
      else {
        // A worker-side failure may be environmental: retry once on the main thread.
        if (typeof console !== "undefined") console.warn(`[fitx] character worker failed for ${job.id}: ${message.message}`);
        runOnMainThread(job);
      }
    }
    pump();
  };
  worker.onerror = (event) => {
    event.preventDefault();
    failWorkers(event.message || "worker error");
  };
  worker.onmessageerror = () => failWorkers("message could not be deserialised");
  return entry;
}

let pumpScheduled = false;
/** Dispatch on a microtask so requests made together are sorted into cast order first. */
function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  queueMicrotask(() => {
    pumpScheduled = false;
    pump();
  });
}

function terminatePool() {
  for (const entry of pool) entry.worker.terminate();
  pool = [];
}

function pump() {
  if (workersFailed) return;
  if (releasing) {
    if (!queue.length && pool.every((entry) => entry.job === null)) {
      releasing = false;
      terminatePool();
      return;
    }
  }
  queue.sort((a, b) => priority(a.id) - priority(b.id));
  // Spawn the pool up front: module loading overlaps the first generation even while the other
  // jobs are held back.
  const wanted = Math.min(poolSize(), queue.length + pool.filter((e) => e.job).length);
  while (pool.length < wanted) {
    const created = createPoolWorker();
    if (!created) return;
    pool.push(created);
  }
  while (queue.length && exclusive === null) {
    const entry = pool.find((candidate) => candidate.job === null);
    if (!entry) return;
    const job = queue.shift() as Job;
    entry.job = job;
    // The film's opening character (first in cast order) runs alone until it is ready.
    if (priority(job.id) === 0) exclusive = job.id;
    const request: CharacterWorkerRequest = { type: "generate", id: job.id };
    entry.worker.postMessage(request);
  }
}

/** Generated mesh data for a character (cached; concurrent calls share one generation). */
export function loadCharacter(id: CharacterId): Promise<CharacterMeshData> {
  const cached = cache.get(id);
  if (cached) return cached;
  releasing = false;
  const promise: Promise<CharacterMeshData> = new Promise<CharacterMeshData>((resolve, reject) => {
    const job: Job = { id, resolve, reject };
    if (workersFailed || typeof Worker === "undefined") {
      runOnMainThread(job);
      return;
    }
    queue.push(job);
    schedulePump();
  }).then(
    (data) => {
      ready.set(id, data);
      return data;
    },
    (error: unknown) => {
      // Forget the failure (a later call retries) unless a newer request already replaced it.
      if (cache.get(id) === promise) cache.delete(id);
      throw error;
    },
  );
  cache.set(id, promise);
  return promise;
}

/** Starts generating several characters (cast order wins: Maya first). */
export function preloadCharacters(ids: readonly CharacterId[] = CAST_ORDER): Promise<CharacterMeshData[]> {
  const ordered = [...ids].sort((a, b) => priority(a) - priority(b));
  return Promise.all(ordered.map((id) => loadCharacter(id)));
}

/** Already generated data, or undefined (never starts work). */
export function getCachedCharacter(id: CharacterId): CharacterMeshData | undefined {
  return ready.get(id);
}

/**
 * Lets queued and in-flight generations finish (their results are cached, so a replay or React's
 * development double-mount reuses them instead of starting over), then terminates the idle pool.
 * A new `loadCharacter` call cancels the release.
 */
export function releaseCharacterWorkers() {
  releasing = true;
  schedulePump();
}

/**
 * Terminates the worker pool now. Finished results stay cached (instant replay); unfinished jobs
 * are rejected and forgotten so a later `loadCharacter` starts them again.
 */
export function disposeCharacterWorkers() {
  const aborted: Job[] = [];
  for (const entry of pool) {
    if (entry.job) aborted.push(entry.job);
    entry.worker.terminate();
  }
  pool = [];
  aborted.push(...queue.splice(0));
  exclusive = null;
  for (const job of aborted) {
    cache.delete(job.id);
    job.reject(new Error("character workers disposed"));
  }
}
