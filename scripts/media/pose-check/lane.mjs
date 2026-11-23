// The browser lane for the pose check (wave 2, brief 1.3): one Chrome or encode job on the machine at a time, through
// the same directory lock as .redesign/e2e.sh (`.redesign/checks/.e2e-lock`, a `pid` file; stale once that process
// has exited or the directory is older than 120 minutes). While it waits, a job gives back its heavy.sh slot; once it
// holds the lock it writes `job` (kind, label, start time), touches the lock at least every 10 minutes, and removes
// it on exit, SIGINT and SIGTERM. (film-lab's scripts/brand/films/lane.mjs does the same for renders and encodes.)
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_LOCK = "/Users/alphinshaju/Documents/all files/Fitx/worktrees/.redesign/checks/.e2e-lock";
export const STALE_MS = 120 * 60 * 1000;
export const KEEP_ALIVE_MS = 5 * 60 * 1000;

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
};

/** Gives back the heavy.sh slot this process was started in (when its holder is our parent), as e2e.sh does. */
export function releaseHeavySlot(env = process.env, ppid = process.ppid) {
  const slot = env.FITX_HEAVY_SLOT;
  if (!slot) return false;
  let released = false;
  try {
    if (readFileSync(path.join(slot, "pid"), "utf8").trim() === String(ppid)) { rmSync(slot, { recursive: true, force: true }); released = true; }
  } catch { /* no slot file */ }
  delete env.FITX_HEAVY_SLOT;
  return released;
}

/** True when the lock directory belongs to nobody any more. */
export function isStale(lock, { now = Date.now(), isAlive = alive } = {}) {
  if (!existsSync(lock)) return false;
  let pid = NaN;
  try { pid = Number(readFileSync(path.join(lock, "pid"), "utf8").trim()); } catch { /* not written yet */ }
  if (Number.isInteger(pid) && pid > 0 && !isAlive(pid)) return true;
  return now - statSync(lock).mtimeMs > STALE_MS;
}

/** One attempt: true when this process now holds the lock. */
export function tryLock(lock, { pid = process.pid, job, now = () => new Date(), isAlive = alive } = {}) {
  try {
    mkdirSync(lock);
  } catch {
    if (!isStale(lock, { now: now().getTime(), isAlive })) return false;
    rmSync(lock, { recursive: true, force: true });
    try { mkdirSync(lock); } catch { return false; }
  }
  writeFileSync(path.join(lock, "pid"), `${pid}\n`);
  writeFileSync(path.join(lock, "job"), `${JSON.stringify({ ...job, startedAt: now().toISOString() })}\n`);
  return true;
}

/** Touches the lock so a long job never looks stale. */
export function keepAlive(lock, now = new Date()) {
  try { utimesSync(lock, now, now); } catch { /* lock gone */ }
}

/** Waits for the lane (15 s between tries, at most `maxWaitMs`), then returns a release function. */
export async function acquireLane({ lock = DEFAULT_LOCK, job, maxWaitMs = 4 * 60 * 60 * 1000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console.log } = {}) {
  releaseHeavySlot();
  const started = Date.now();
  while (!tryLock(lock, { job })) {
    if (Date.now() - started > maxWaitMs) throw new Error("The browser lane stayed busy; giving up");
    log("[pose-check] waiting for the browser lane");
    await sleep(15000);
  }
  const timer = setInterval(() => keepAlive(lock), KEEP_ALIVE_MS);
  timer.unref?.();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(timer);
    try { if (readFileSync(path.join(lock, "pid"), "utf8").trim() === String(process.pid)) rmSync(lock, { recursive: true, force: true }); } catch { /* already gone */ }
  };
  process.once("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { release(); process.exit(130); });
  return release;
}
