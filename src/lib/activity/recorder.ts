import { usableWeight } from "./calories";
import { COARSE_ACCURACY_M, GOOD_ACCURACY_M, SPORT_CONFIG } from "./config";
import { busyRecordings, holdRecordingLock, reconcileRecordings, type LocksLike } from "./device-recordings";
import { ActivityEngine, type EngineSnapshot } from "./engine";
import { defaultTitle } from "./format";
import type { RecordingStore, StoredEntry, StoredRecording } from "./local-store";
import { buildActivityRecord, type ActivityRecord } from "./record";
import type { ControlEvent, Fix, LogEntry, Sport } from "./types";

/*
 * Browser side of activity recording: location updates, the screen wake lock, page visibility
 * and on-device persistence around the engine. Every browser API is passed in, so the whole
 * controller runs under `node --test` with fakes.
 *
 * What browsers allow (W3C Geolocation, Screen Wake Lock): positions are delivered only while the
 * page is visible. Locking the screen or switching apps stops them, and the wake lock is released
 * whenever the page is hidden. The recorder therefore keeps the screen on while recording,
 * re-acquires the lock when the page returns, and records any hidden time as an interruption.
 */

export type RecorderPhase = "idle" | "locating" | "recording" | "paused" | "finished";
export type LocationIssue = "unsupported" | "insecure" | "denied" | "unavailable" | "timeout" | "searching" | "coarse";
export type PermissionState = "granted" | "prompt" | "denied" | "unknown";
export type WakeLockState = "off" | "active" | "unsupported" | "failed";
export type SignalQuality = "none" | "good" | "fair" | "weak" | "coarse";

export type RestorableRecording = {
  clientId: string;
  sport: Sport;
  startedAt: number;
  lastActivityAt: number;
  distanceM: number;
  paused: boolean;
  /** False once it is too old to continue (an activity can last at most 48 hours): only finish it. */
  canResume: boolean;
};

/** The longest activity the database accepts (activities.elapsed_seconds, 48 hours). */
export const MAX_ELAPSED_MS = 48 * 3600 * 1000;
/** Resuming is offered only while there is at least an hour left before that limit. */
export const RESUME_LIMIT_MS = MAX_ELAPSED_MS - 3600 * 1000;

export type FinishResult = { record: ActivityRecord; savedLocally: boolean };

export type RecorderSnapshot = {
  phase: RecorderPhase;
  sport: Sport;
  issue: LocationIssue | null;
  permission: PermissionState;
  wakeLock: WakeLockState;
  /** False when recordings can only be kept in memory on this browser. */
  durable: boolean;
  signal: SignalQuality;
  accuracyM: number | null;
  lastFix: Fix | null;
  stats: EngineSnapshot | null;
  /** Estimated kcal so far; null without a body weight. */
  kcal: number | null;
  clientId: string | null;
  restorable: RestorableRecording | null;
  /** An unfinished recording is being recorded in another FITX window or tab right now. */
  elsewhere: boolean;
  /** When this snapshot was taken (epoch ms): the clock the stats were computed for. */
  now: number;
};

type Listener = () => void;
type PositionLike = { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number; altitude: number | null; altitudeAccuracy: number | null; speed: number | null } };
type PositionErrorLike = { code: number; message?: string };
type GeolocationLike = {
  watchPosition(success: (position: PositionLike) => void, error: (error: PositionErrorLike) => void, options: { enableHighAccuracy: boolean; maximumAge: number; timeout: number }): number;
  clearWatch(id: number): void;
};
type WakeLockSentinelLike = { released?: boolean; release(): Promise<void>; addEventListener(type: "release", listener: () => void): void };
type EventTargetLike = { addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void };

type PermissionStatusLike = { readonly state: string; addEventListener?(type: "change", listener: () => void): void };

export type RecorderDeps = {
  geolocation: GeolocationLike | null;
  /** navigator.permissions.query for "geolocation", when available. */
  queryPermission?: (() => Promise<PermissionStatusLike>) | null;
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } | null;
  document?: (EventTargetLike & { visibilityState: string }) | null;
  window?: EventTargetLike | null;
  isSecureContext: boolean;
  store: RecordingStore;
  now(): number;
  randomId(): string;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** navigator.locks, when available: marks a recording as live in this window. */
  locks?: LocksLike | null;
};

/** Location requests: precise, never cached, and an error if nothing arrives within 20 s. */
export const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 };
/** A position older than this when it arrives is a cached one and is ignored. */
const STALE_FIX_MS = 15_000;
/** No position for this long while recording on a visible page: "looking for GPS". */
const SEARCHING_AFTER_MS = 15_000;
const FLUSH_EVERY_MS = 2_000;
/** Fixes in a row needed before calling the location "approximate". */
const COARSE_STREAK = 3;

export function toFix(position: PositionLike, receivedAt: number): Fix | null {
  const c = position.coords;
  if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || !Number.isFinite(c.accuracy)) return null;
  if (receivedAt - position.timestamp > STALE_FIX_MS) return null;
  const finiteOrNull = (value: number | null) => (value === null || !Number.isFinite(value) ? null : value);
  const speed = finiteOrNull(c.speed);
  return {
    t: Math.min(position.timestamp || receivedAt, receivedAt),
    lat: c.latitude,
    lng: c.longitude,
    acc: c.accuracy,
    alt: finiteOrNull(c.altitude),
    altAcc: finiteOrNull(c.altitudeAccuracy),
    speed: speed !== null && speed >= 0 ? speed : null,
  };
}

export function signalFor(accuracy: number | null): SignalQuality {
  if (accuracy === null) return "none";
  if (accuracy <= GOOD_ACCURACY_M) return "good";
  if (accuracy <= SPORT_CONFIG.run.maxAccuracyM) return "fair";
  if (accuracy <= COARSE_ACCURACY_M) return "weak";
  return "coarse";
}

export class ActivityRecorder {
  private readonly deps: RecorderDeps;
  private listeners = new Set<Listener>();
  private snapshotCache: RecorderSnapshot;
  private phase: RecorderPhase = "idle";
  private sport: Sport = "run";
  private issue: LocationIssue | null = null;
  private permission: PermissionState = "unknown";
  private wakeLockState: WakeLockState = "off";
  private sentinel: WakeLockSentinelLike | null = null;
  private watchId: number | null = null;
  private ticker: unknown = null;
  private lastFix: Fix | null = null;
  private lastFixAt = 0;
  private coarseStreak = 0;
  private engine: ActivityEngine | null = null;
  private log: LogEntry[] = [];
  private pending: StoredEntry[] = [];
  private lastFlush = 0;
  private flushing: Promise<void> = Promise.resolve();
  private clientId: string | null = null;
  private userId: string | null = null;
  private weightKg: number | null = null;
  private restorable: RestorableRecording | null = null;
  private elsewhere = false;
  private releaseLock: () => void = () => undefined;
  private disposed = false;

  constructor(deps: RecorderDeps) {
    this.deps = deps;
    this.snapshotCache = this.buildSnapshot();
    this.onVisibility = this.onVisibility.bind(this);
    this.onPageHide = this.onPageHide.bind(this);
    deps.document?.addEventListener("visibilitychange", this.onVisibility);
    deps.window?.addEventListener("pagehide", this.onPageHide);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RecorderSnapshot => this.snapshotCache;

  private emit(): void {
    this.snapshotCache = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): RecorderSnapshot {
    const now = this.deps.now();
    const stats = this.engine ? this.engine.snapshot(now) : null;
    return {
      phase: this.phase,
      sport: this.sport,
      issue: this.issue,
      permission: this.permission,
      wakeLock: this.wakeLockState,
      durable: this.deps.store.durable,
      signal: this.coarseStreak >= COARSE_STREAK ? "coarse" : signalFor(this.lastFix?.acc ?? null),
      accuracyM: this.lastFix?.acc ?? null,
      lastFix: this.lastFix,
      stats,
      kcal: this.engine && this.weightKg !== null ? this.engine.kcal(this.weightKg) : null,
      clientId: this.clientId,
      restorable: this.restorable,
      elsewhere: this.elsewhere,
      now,
    };
  }

  /** Checks support and permission, and looks for this account's unfinished recording. */
  async init(userId: string): Promise<void> {
    this.userId = userId;
    if (!this.deps.isSecureContext) this.issue = "insecure";
    else if (!this.deps.geolocation) this.issue = "unsupported";
    if (this.deps.queryPermission) {
      try {
        const status = await this.deps.queryPermission();
        const read = () => (status.state === "granted" || status.state === "denied" || status.state === "prompt" ? status.state : "unknown");
        this.permission = read();
        status.addEventListener?.("change", () => {
          this.permission = read();
          if (this.permission === "denied") this.setIssue("denied");
          else if (this.issue === "denied") this.setIssue(null);
          this.emit();
        });
      } catch {
        this.permission = "unknown";
      }
    }
    if (this.permission === "denied" && !this.issue) this.issue = "denied";
    try {
      // A recording another window is running is left alone; stale rows are tidied first.
      const busy = await busyRecordings(this.deps.locks);
      const recordings = await reconcileRecordings(this.deps.store, userId, busy);
      const active = recordings.filter((recording) => recording.state === "active");
      this.elsewhere = active.some((recording) => busy.has(recording.clientId));
      const candidate = active.find((recording) => !busy.has(recording.clientId));
      if (candidate) {
        const entries = await this.deps.store.readEntries(candidate.clientId);
        const engine = ActivityEngine.replay(entries);
        const last = entries.length ? entryTime(entries[entries.length - 1]) : candidate.startedAt;
        if (engine.status === "recording" || engine.status === "paused") {
          this.restorable = {
            clientId: candidate.clientId,
            sport: candidate.sport,
            startedAt: candidate.startedAt,
            lastActivityAt: last,
            distanceM: engine.distanceM,
            paused: engine.status === "paused",
            canResume: this.deps.now() - candidate.startedAt < RESUME_LIMIT_MS,
          };
        }
      }
    } catch {
      // Without readable device storage there is simply nothing to restore.
    }
    this.emit();
  }

  setSport(sport: Sport): void {
    if (this.phase === "recording" || this.phase === "paused") return;
    this.sport = sport;
    this.emit();
  }

  /** Starts location updates (asks for permission if needed) to show the signal before starting. */
  warmUp(): void {
    if (this.disposed || this.watchId !== null) return;
    const geo = this.deps.geolocation;
    if (!this.deps.isSecureContext) return this.setIssue("insecure");
    if (!geo) return this.setIssue("unsupported");
    if (this.phase === "idle") this.phase = "locating";
    if (this.issue === "denied" || this.issue === "unavailable" || this.issue === "timeout") this.issue = null;
    this.lastFixAt = this.deps.now();
    this.watchId = geo.watchPosition((position) => this.onPosition(position), (error) => this.onPositionError(error), WATCH_OPTIONS);
    this.ensureTicker();
    this.emit();
  }

  private stopWatching(): void {
    if (this.watchId !== null) this.deps.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
  }

  private onPosition(position: PositionLike): void {
    const now = this.deps.now();
    const fix = toFix(position, now);
    if (!fix) return;
    this.lastFix = fix;
    this.lastFixAt = now;
    this.coarseStreak = fix.acc > COARSE_ACCURACY_M ? this.coarseStreak + 1 : 0;
    if (this.permission !== "granted") this.permission = "granted";
    if (this.coarseStreak >= COARSE_STREAK) this.issue = "coarse";
    else if (this.issue && this.issue !== "insecure" && this.issue !== "unsupported") this.issue = null;
    if (this.phase === "recording" && this.engine) this.record({ kind: "fix", fix });
    this.emit();
  }

  private onPositionError(error: PositionErrorLike): void {
    if (error.code === 1) {
      this.permission = "denied";
      this.stopWatching();
      this.setIssue("denied");
      return;
    }
    // Unavailable and timeout are reported, but the watch keeps running and may recover.
    this.setIssue(error.code === 3 ? "timeout" : "unavailable");
  }

  private setIssue(issue: LocationIssue | null): void {
    this.issue = issue;
    this.emit();
  }

  /** Begins recording. Needs an account (`init`) and, ideally, a warmed-up location. */
  async start(sport: Sport, weightKg: unknown): Promise<void> {
    if (this.phase === "recording" || this.phase === "paused" || this.phase === "finished" || !this.userId) return;
    // Everything up to the first await happens at once, so a second tap finds it already recording.
    this.sport = sport;
    this.weightKg = usableWeight(weightKg);
    const clientId = this.deps.randomId();
    this.clientId = clientId;
    this.engine = new ActivityEngine();
    this.log = [];
    this.pending = [];
    this.restorable = null;
    this.phase = "recording";
    const t = this.deps.now();
    this.releaseLock = holdRecordingLock(this.deps.locks, clientId);
    const stored: StoredRecording = { clientId, userId: this.userId, sport, startedAt: t, state: "active", updatedAt: t };
    // The row is written before its first log entries (the flush queue keeps the order).
    this.flushing = this.flushing.then(() => this.deps.store.saveRecording(stored)).catch(() => undefined);
    this.control({ type: "start", t, sport });
    // The fix that was showing the signal is recent: let it begin the route.
    if (this.lastFix && t - this.lastFixAt < 5_000) this.record({ kind: "fix", fix: { ...this.lastFix, t: Math.max(this.lastFix.t, t) } });
    this.emit();
    this.warmUp();
    await this.acquireWakeLock();
    await this.flush();
    this.emit();
  }

  /** Continues an unfinished recording found by `init`, with the time away as an interruption. */
  async resumeRestored(weightKg: unknown): Promise<boolean> {
    const restorable = this.restorable;
    if (!restorable || !restorable.canResume || !this.userId) return false;
    const entries = await this.deps.store.readEntries(restorable.clientId);
    const engine = ActivityEngine.replay(entries);
    if (engine.status !== "recording" && engine.status !== "paused") return false;
    this.engine = engine;
    this.log = entries.slice();
    this.pending = [];
    this.clientId = restorable.clientId;
    this.sport = restorable.sport;
    this.weightKg = usableWeight(weightKg);
    this.restorable = null;
    this.releaseLock = holdRecordingLock(this.deps.locks, restorable.clientId);
    const now = this.deps.now();
    if (engine.status === "recording") {
      // The page was gone from just after its last saved entry until now: an interruption.
      this.control({ type: "hidden", t: restorable.lastActivityAt + 1 });
      this.control({ type: "visible", t: Math.max(now, restorable.lastActivityAt + 2) });
      this.phase = "recording";
    } else {
      this.phase = "paused";
    }
    this.warmUp();
    await this.acquireWakeLock();
    await this.flush();
    this.emit();
    return true;
  }

  pause(): void {
    if (this.phase !== "recording") return;
    this.control({ type: "pause", t: this.deps.now() });
    this.phase = "paused";
    void this.flush();
    this.emit();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.control({ type: "resume", t: this.deps.now() });
    this.phase = "recording";
    void this.acquireWakeLock();
    void this.flush();
    this.emit();
  }

  /**
   * Ends the recording and stores the finished summary on the device for upload. `endAt` lets an
   * abandoned restored recording end when its data ended instead of now. `savedLocally` is false
   * when the device copy could not be written: the record must then be uploaded (or kept) from
   * memory.
   */
  async finish(title: string | null, endAt?: number): Promise<FinishResult | null> {
    if (this.restorable && !this.engine) {
      const resumed = await this.loadRestoredForFinish();
      if (!resumed) return null;
    }
    if (!this.engine || !this.clientId || !this.userId || (this.phase !== "recording" && this.phase !== "paused")) return null;
    let t = endAt ?? this.deps.now();
    const started = this.engine.startedAt ?? t;
    if (t - started > MAX_ELAPSED_MS) {
      // Past the 48-hour limit (a recording left paused or open for days): end where its data ended.
      const lastEntry = this.log.length ? entryTime(this.log[this.log.length - 1]) : started;
      t = Math.max(started, Math.min(started + MAX_ELAPSED_MS, lastEntry));
    }
    this.control({ type: "finish", t });
    this.phase = "finished";
    this.stopWatching();
    this.stopTicker();
    await this.releaseWakeLock();
    await this.flush();
    const record = buildActivityRecord(this.engine, {
      clientId: this.clientId,
      title: title?.trim() || defaultTitle(this.sport, new Date(this.engine.startedAt ?? t)),
      weightKg: this.weightKg,
      log: this.log,
    });
    const stored: StoredRecording = { clientId: this.clientId, userId: this.userId, sport: this.sport, startedAt: record.startedAt, state: "finished", updatedAt: t, record, uploadAttempts: 0 };
    let savedLocally = true;
    await this.deps.store.saveRecording(stored).catch(() => { savedLocally = false; });
    this.releaseLock();
    this.emit();
    return { record, savedLocally };
  }

  /** Finishes a restored recording at the time its data ended (when it is not resumed). */
  async finishRestored(weightKg: unknown): Promise<FinishResult | null> {
    const restorable = this.restorable;
    if (!restorable) return null;
    if (!(await this.loadRestoredForFinish())) return null;
    this.weightKg = usableWeight(weightKg);
    return this.finish(null, restorable.lastActivityAt);
  }

  private async loadRestoredForFinish(): Promise<boolean> {
    const restorable = this.restorable;
    if (!restorable) return false;
    const entries = await this.deps.store.readEntries(restorable.clientId);
    const engine = ActivityEngine.replay(entries);
    if (engine.status !== "recording" && engine.status !== "paused") return false;
    this.engine = engine;
    this.log = entries.slice();
    this.clientId = restorable.clientId;
    this.sport = restorable.sport;
    this.phase = engine.status;
    this.restorable = null;
    return true;
  }

  /** Throws the current (or restorable) recording away, on the device too. */
  async discard(): Promise<void> {
    const clientId = this.clientId ?? this.restorable?.clientId ?? null;
    this.stopTicker();
    this.releaseLock();
    await this.releaseWakeLock();
    this.engine = null;
    this.log = [];
    this.pending = [];
    this.clientId = null;
    this.restorable = null;
    this.phase = this.watchId !== null ? "locating" : "idle";
    if (clientId) await this.deps.store.deleteRecording(clientId).catch(() => undefined);
    if (this.watchId !== null) this.ensureTicker();
    this.emit();
  }

  /** Stops everything this recorder started; unfinished data stays on the device for restore. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopWatching();
    this.stopTicker();
    this.deps.document?.removeEventListener("visibilitychange", this.onVisibility);
    this.deps.window?.removeEventListener("pagehide", this.onPageHide);
    await this.releaseWakeLock();
    await this.flush();
    this.releaseLock();
    this.listeners.clear();
  }

  private control(event: ControlEvent): void {
    this.record({ kind: "control", event });
  }

  private record(entry: LogEntry): void {
    if (!this.engine) return;
    this.engine.apply(entry);
    this.log.push(entry);
    this.pending.push({ seq: this.log.length - 1, entry });
    const now = this.deps.now();
    if (entry.kind === "control" || now - this.lastFlush >= FLUSH_EVERY_MS) void this.flush();
  }

  /** Writes buffered log entries to the device (serialised, so entries land in order). */
  flush(): Promise<void> {
    const clientId = this.clientId;
    const batch = this.pending;
    this.pending = [];
    this.lastFlush = this.deps.now();
    if (!clientId || !batch.length) return this.flushing;
    this.flushing = this.flushing.then(() => this.deps.store.appendEntries(clientId, batch)).catch(() => undefined);
    return this.flushing;
  }

  private ensureTicker(): void {
    if (this.ticker !== null) return;
    this.ticker = this.deps.setInterval(() => this.tick(), 1000);
  }

  private stopTicker(): void {
    if (this.ticker !== null) this.deps.clearInterval(this.ticker);
    this.ticker = null;
  }

  private tick(): void {
    const visible = (this.deps.document?.visibilityState ?? "visible") === "visible";
    if (this.phase === "recording" && visible && this.watchId !== null && this.deps.now() - this.lastFixAt > SEARCHING_AFTER_MS && !this.issue) {
      this.issue = "searching";
    }
    if (this.pending.length && this.deps.now() - this.lastFlush >= FLUSH_EVERY_MS) void this.flush();
    this.emit();
  }

  private async acquireWakeLock(): Promise<void> {
    const api = this.deps.wakeLock;
    if (!api) {
      this.wakeLockState = "unsupported";
      return;
    }
    if (this.sentinel && !this.sentinel.released) return;
    try {
      const sentinel = await api.request("screen");
      this.sentinel = sentinel;
      this.wakeLockState = "active";
      sentinel.addEventListener("release", () => {
        if (this.sentinel === sentinel) {
          this.sentinel = null;
          if (this.wakeLockState === "active") this.wakeLockState = "off";
          this.emit();
        }
      });
    } catch {
      this.wakeLockState = "failed";
    }
    this.emit();
  }

  private async releaseWakeLock(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (this.wakeLockState === "active") this.wakeLockState = "off";
    if (sentinel && !sentinel.released) await sentinel.release().catch(() => undefined);
  }

  private onVisibility(): void {
    const state = this.deps.document?.visibilityState;
    const now = this.deps.now();
    if (state === "hidden") {
      if (this.phase === "recording") this.control({ type: "hidden", t: now });
      void this.flush();
    } else if (state === "visible") {
      if (this.phase === "recording") {
        this.control({ type: "visible", t: now });
        this.lastFixAt = now;
      }
      if (this.phase === "recording" || this.phase === "paused") void this.acquireWakeLock();
    }
    this.emit();
  }

  private onPageHide(): void {
    void this.flush();
  }
}

function entryTime(entry: LogEntry): number {
  return entry.kind === "fix" ? entry.fix.t : entry.event.t;
}
