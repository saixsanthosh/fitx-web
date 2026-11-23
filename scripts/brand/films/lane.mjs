// The browser lane (BRIEF-2 1.3): one lock for everything on this Mac that drives Chrome or encodes video (e2e runs,
// renders, encodes, pose checks, the admin-live harness), so two such jobs never share 8 GB of memory.
//
// It is the same directory lock `.redesign/e2e.sh` takes (mkdir plus a `pid` file), with the same stale rule: the
// owner's PID has exited, or the directory is older than 120 minutes. This module implements it once for render.mjs,
// encode.mjs and the pose check:
//  - give the heavy.sh slot back before queueing (a waiting job must not hold a CPU slot), exactly like e2e.sh: when
//    FITX_HEAVY_SLOT is set and its `pid` is our parent (heavy.sh), remove it and unset the variable;
//  - once the lock is held, run the work under a fresh heavy.sh slot (`heavySpawn`);
//  - keep-alive: touch the lock directory after every shot segment or encode (`touch()`), and on a timer at least
//    every 10 minutes, so a 2.5 h overnight pass never looks stale under the 120-minute rule; write `job` (kind,
//    label, start time) next to `pid`;
//  - remove the lock on exit, including SIGINT and SIGTERM (only while it is still ours).
// Everything takes injectable `fs`, clock, sleep and liveness functions so tests/brand/film-lab.test.ts runs it on a
// fake clock.
import * as realFs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

export const WORKTREES = "/Users/alphinshaju/Documents/all files/Fitx/worktrees";
export const LANE_LOCK = path.join(WORKTREES, ".redesign/checks/.e2e-lock");
export const HEAVY = path.join(WORKTREES, "heavy.sh");

/** e2e.sh's stale age. */
export const STALE_MS = 120 * 60 * 1000;
/** Touch at least this often (well inside the stale age, and the "at least every 10 minutes" rule). */
export const KEEPALIVE_MS = 5 * 60 * 1000;
/** e2e.sh polls every 15 s and gives up after four hours. */
export const POLL_MS = 15 * 1000;
export const GIVE_UP_MS = 4 * 60 * 60 * 1000;

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Gives a heavy.sh slot back, as e2e.sh does: only when FITX_HEAVY_SLOT names a slot whose `pid` is our parent.
 * Returns the slot it released (or null) and always leaves FITX_HEAVY_SLOT unset when it released one.
 */
/** @param {{ env?: Record<string, string | undefined>, ppid?: number, fs?: typeof realFs }} [options] */
export function releaseHeavySlot({ env = process.env, ppid = process.ppid, fs = realFs } = {}) {
  const slot = env.FITX_HEAVY_SLOT;
  if (!slot) return null;
  let holder = null;
  try {
    holder = Number(fs.readFileSync(path.join(slot, "pid"), "utf8").trim());
  } catch {
    holder = null;
  }
  if (holder !== ppid) return null;
  fs.rmSync(slot, { recursive: true, force: true });
  delete env.FITX_HEAVY_SLOT;
  return slot;
}

/** Why the lock at `dir` may be taken over (`"exited"`, `"old"`), or null while its owner holds it. */
export function staleReason(dir, { fs = realFs, now = Date.now, alive = isAlive } = {}) {
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return null;
  }
  let owner = null;
  try {
    owner = Number(fs.readFileSync(path.join(dir, "pid"), "utf8").trim()) || null;
  } catch {
    owner = null;
  }
  if (owner !== null && !alive(owner)) return "exited";
  if (now() - stat.mtimeMs > STALE_MS) return "old";
  return null;
}

/**
 * Takes the lane: waits (polling) until the lock is free or stale, then writes `pid` and `job`. Resolves with a
 * handle: `touch()`, `release()`, `startKeepAlive()`.
 */
/**
 * @param {{ kind: string, label: string, dir?: string, fs?: typeof realFs, now?: () => number, sleep?: (ms: number) => Promise<unknown>, alive?: (pid: number) => boolean, pid?: number, log?: (line: string) => void }} options
 */
export async function acquireLane({
  kind,
  label,
  dir = LANE_LOCK,
  fs = realFs,
  now = Date.now,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  alive = isAlive,
  pid = process.pid,
  log = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const started = now();
  let announced = false;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const reason = staleReason(dir, { fs, now, alive });
    if (reason) {
      log(`[lane] taking over a stale lock (${reason})`);
      fs.rmSync(dir, { recursive: true, force: true });
      continue;
    }
    if (now() - started > GIVE_UP_MS) throw new Error("lane lock: waited four hours, giving up");
    if (!announced) {
      log("[lane] waiting for the browser lane (another render, encode or e2e run holds it)");
      announced = true;
    }
    await sleep(POLL_MS);
  }
  fs.writeFileSync(path.join(dir, "pid"), `${pid}\n`);
  fs.writeFileSync(path.join(dir, "job"), `${JSON.stringify({ kind, label, start: new Date(now()).toISOString() })}\n`);
  return laneHandle({ dir, fs, now, pid });
}

/** The handle of a held lane (also used by a child that was handed the lock through FITX_LANE_LOCK). */
export function laneHandle({ dir = LANE_LOCK, fs = realFs, now = Date.now, pid = process.pid } = {}) {
  let last = now();
  let timer = null;
  const ours = () => {
    try {
      return Number(fs.readFileSync(path.join(dir, "pid"), "utf8").trim()) === pid;
    } catch {
      return false;
    }
  };
  const handle = {
    dir,
    get lastTouch() {
      return last;
    },
    /** Marks the lock fresh (after a shot segment or an encode). */
    touch() {
      const at = now();
      try {
        fs.utimesSync(dir, new Date(at), new Date(at));
        last = at;
      } catch {
        // The lock is gone (someone removed a lock they thought stale): carry on, the job's own output is safe.
      }
      return last;
    },
    /** True when the timer should touch now. */
    due(at = now()) {
      return at - last >= KEEPALIVE_MS;
    },
    startKeepAlive(setTimer = setInterval, clearTimer = clearInterval) {
      if (timer) return handle;
      timer = setTimer(() => {
        if (handle.due()) handle.touch();
      }, Math.min(60 * 1000, KEEPALIVE_MS));
      timer?.unref?.();
      handle.stopKeepAlive = () => {
        clearTimer(timer);
        timer = null;
      };
      return handle;
    },
    stopKeepAlive() {},
    /** Removes the lock if it is still ours. */
    release() {
      handle.stopKeepAlive();
      if (ours()) fs.rmSync(dir, { recursive: true, force: true });
    },
    ours,
  };
  return handle;
}

/** Releases the lane on exit, SIGINT and SIGTERM (signals then exit with 130 / 143). */
export function releaseOnExit(handle, { onSignal } = {}) {
  const release = () => handle.release();
  process.once("exit", release);
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.once(signal, () => {
      onSignal?.(signal);
      release();
      process.exit(code);
    });
  }
}

/** Starts `command args` under a fresh heavy.sh slot (FITX_HEAVY_SLOT removed from its environment). */
export function heavySpawn(command, args, options = {}) {
  const env = { ...process.env, ...(options.env ?? {}) };
  delete env.FITX_HEAVY_SLOT;
  return spawn("/bin/zsh", [HEAVY, command, ...args], { ...options, env });
}

/**
 * The whole pattern for a lane job: release our slot, wait for the lane, run `work(handle)` with keep-alive, release
 * on the way out (also on signals). `work` runs its heavy children through `heavySpawn`.
 */
export async function withLane({ kind, label }, work) {
  const released = releaseHeavySlot();
  if (released) process.stderr.write(`[lane] gave back ${path.basename(released)} while waiting\n`);
  const handle = await acquireLane({ kind, label });
  releaseOnExit(handle);
  handle.startKeepAlive();
  try {
    return await work(handle);
  } finally {
    handle.release();
  }
}
