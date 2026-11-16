import { estimateKcal } from "./calories";
import { SPORT_CONFIG, type SportConfig } from "./config";
import { haversine, projector } from "./geo";
import type { ControlEvent, Fix, Gap, LatLng, LogEntry, RoutePoint, Split, Sport } from "./types";

/*
 * The activity recording engine: turns the browser's position reports and the recorder's
 * controls into a route, distance, moving time, splits and honest interruptions.
 *
 * It is a deterministic state machine: the same log entries in the same order always give the
 * same result, so a recording rebuilt from the on-device log after a reload or crash matches what
 * was shown before, and stored raw points can be replayed when the filters are tuned.
 *
 * For every fix received while recording:
 *  1. Fixes with poor accuracy, invalid values or out-of-order times are kept out of the route.
 *  2. A fix after the page was hidden (screen locked, app switched), or after a long silence that
 *     also moved far, ends an interruption: the route breaks and no distance is added across it.
 *  3. Implausible jumps (faster than the sport allows, beyond both fixes' accuracy) are dropped;
 *     three consistent fixes elsewhere re-anchor the route (also recorded as an interruption).
 *  4. A constant-velocity Kalman filter smooths the position (accuracy is the measurement noise).
 *  5. Distance and moving time come from one of two models:
 *     - "doppler": when the phone reports its ground speed with each fix (GNSS Doppler, far more
 *       precise than differences of noisy positions), distance is speed x time while moving, and
 *       moving vs stopped follows that speed. A cross-check against the positions drops this
 *       model for the rest of the recording if the reported speeds look wrong.
 *     - "position": otherwise, the smoothed position is committed only after moving a step that
 *       grows with the reported accuracy; with no step for a while the person counts as stopped,
 *       and moving again needs a larger exit radius. Standing-still jitter then adds nothing.
 */

export type EngineStatus = "idle" | "recording" | "paused" | "finished";
export type DistanceModel = "position" | "doppler";

type Sample = { t: number; d: number; segment: number };

export type EngineSnapshot = {
  status: EngineStatus;
  sport: Sport;
  startedAt: number | null;
  endedAt: number | null;
  /** Wall clock since the start, including pauses and interruptions. */
  elapsedSeconds: number;
  /** Elapsed time minus manual pauses: the recording clock shown while tracking. */
  activeSeconds: number;
  pausedSeconds: number;
  movingSeconds: number;
  distanceM: number;
  avgSpeedMps: number | null;
  avgPaceSecondsPerKm: number | null;
  /** Recent speed over the sport's live window, 0 when stopped, null while not yet known. */
  currentSpeedMps: number | null;
  currentPaceSecondsPerKm: number | null;
  /** Top speed from the phone's own speed readings; null when it gave none (not guessed). */
  maxSpeedMps: number | null;
  elevationGainM: number | null;
  stopped: boolean;
  distanceModel: DistanceModel;
  splits: Split[];
  gaps: Gap[];
  gapSeconds: number;
  /** Committed route, one array per continuous stretch (never joined across gaps or pauses). */
  segments: RoutePoint[][];
  /** Changes whenever the route changes, for cheap re-render checks. */
  routeVersion: number;
  lastFix: Fix | null;
  fixCount: number;
  acceptedCount: number;
  rejectedAccuracyCount: number;
  rejectedJumpCount: number;
};

const SPLIT_M = 1000;
/** A fix this long after the previous one, with the page hidden in between, is an interruption. */
const HIDDEN_GAP_MIN_MS = 5_000;
/** Consistent fixes needed to accept that the position really moved after a jump. */
const JUMP_CONFIRMATIONS = 3;
/** Live samples older than this are dropped. */
const SAMPLE_RETENTION_MS = 120_000;
/**
 * Device speeds averaged for the top speed (about 5 s). Without device speeds there is no top
 * speed: from positions alone it reads 20-50% high (slow GPS drift adds apparent speed, and the
 * maximum picks the worst moment).
 */
const MAX_SPEED_SAMPLES = 5;
/** Altitude changes smaller than this are treated as GPS noise, metres. */
const ELEVATION_HYSTERESIS_M = 5;
const MAX_VERTICAL_ACCURACY_M = 15;
/** Fixes in a row that must carry a device speed before the doppler model is used. */
const DOPPLER_REQUIRED_FIXES = 10;
/** A missing device speed may be bridged with the previous one for this long. */
const DOPPLER_HOLD_MS = 3_000;
/** Windows in which device speeds are checked against the positions (too high / too low). */
const DOPPLER_HIGH_WINDOW_MS = 20_000;
const DOPPLER_LOW_WINDOW_MS = 60_000;

/** One axis of a constant-velocity Kalman filter: position, velocity and their covariance. */
type Axis = { p: number; v: number; pp: number; pv: number; vv: number };
type Smoother = { projection: ReturnType<typeof projector>; x: Axis; y: Axis; t: number };

/**
 * Phones report the radius that holds the true position about 68% of the time; for a 2-D normal
 * error that radius is about 1.5 standard deviations per axis.
 */
function measurementVariance(accuracyM: number): number {
  return Math.max(1, accuracyM / 1.5) ** 2;
}

function newAxis(positionVariance: number, speedVariance: number): Axis {
  return { p: 0, v: 0, pp: positionVariance, pv: 0, vv: speedVariance };
}

/** Moves the axis forward `dt` seconds under white-noise acceleration with variance `q`. */
function predictAxis(a: Axis, dt: number, q: number): void {
  if (dt <= 0) return;
  a.p += a.v * dt;
  a.pp += 2 * dt * a.pv + dt * dt * a.vv + (q * dt ** 4) / 4;
  a.pv += dt * a.vv + (q * dt ** 3) / 2;
  a.vv += q * dt * dt;
}

function updateAxis(a: Axis, measured: number, r: number): void {
  const s = a.pp + r;
  const kp = a.pp / s;
  const kv = a.pv / s;
  const innovation = measured - a.p;
  a.p += kp * innovation;
  a.v += kv * innovation;
  const pp = a.pp;
  const pv = a.pv;
  a.pp = (1 - kp) * pp;
  a.pv = (1 - kp) * pv;
  a.vv -= kv * pv;
}

function validFix(fix: Fix): boolean {
  return Number.isFinite(fix.t) && Number.isFinite(fix.lat) && Number.isFinite(fix.lng) && Number.isFinite(fix.acc)
    && fix.lat >= -90 && fix.lat <= 90 && fix.lng >= -180 && fix.lng <= 180 && fix.acc >= 0
    && !(fix.lat === 0 && fix.lng === 0)
    && (fix.speed === null || (Number.isFinite(fix.speed) && fix.speed >= 0));
}

export class ActivityEngine {
  status: EngineStatus = "idle";
  sport: Sport = "walk";
  private cfg: SportConfig = SPORT_CONFIG.walk;
  startedAt: number | null = null;
  endedAt: number | null = null;
  private pausedMs = 0;
  private pauseStartedAt = 0;
  private hiddenAt: number | null = null;

  /** Smoothed route, one array per continuous stretch. */
  readonly segments: RoutePoint[][] = [];
  /** The raw fixes used for each stretch (for GPX export). */
  readonly acceptedSegments: Fix[][] = [];
  /** Every valid fix received while recording, in order (what gets stored). */
  readonly recordedFixes: Fix[] = [];
  private needNewSegment = true;
  private routeVersion = 0;

  private smoother: Smoother | null = null;
  private position: LatLng | null = null;
  private anchor: RoutePoint | null = null;
  private lastCommitT = 0;
  private moving = true;
  distanceM = 0;
  private movingMs = 0;

  private model: DistanceModel = "position";
  private dopplerDisabled = false;
  private speedStreak = 0;
  private missingSpeedStreak = 0;
  private lastSpeed: { value: number; t: number } | null = null;
  private startRun: { count: number; distance: number; ms: number; fromT: number } = { count: 0, distance: 0, ms: 0, fromT: 0 };
  /** Device-speed distance so far and recent samples, to check the speeds against positions. */
  private speedTotal = 0;
  private speedSamples: Array<{ t: number; total: number; position: LatLng }> = [];

  private lastRecordedT: number | null = null;
  private lastAccepted: Fix | null = null;
  private jumpCandidates: Fix[] = [];

  readonly gaps: Gap[] = [];
  readonly splits: Split[] = [];
  private splitBase = { movingMs: 0, t: 0 };

  private samples: Sample[] = [];
  private maxSpeed = 0;
  /** The last few device speeds, averaged for the maximum speed. */
  private recentSpeeds: number[] = [];

  private altSmoothed: number | null = null;
  private altReference: number | null = null;
  private elevationGain = 0;
  private hasElevation = false;

  lastFix: Fix | null = null;
  private fixCount = 0;
  private acceptedCount = 0;
  private rejectedAccuracy = 0;
  private rejectedJump = 0;

  /** Builds an engine from a recording log. */
  static replay(entries: Iterable<LogEntry>): ActivityEngine {
    const engine = new ActivityEngine();
    for (const entry of entries) engine.apply(entry);
    return engine;
  }

  apply(entry: LogEntry): void {
    if (entry.kind === "fix") this.addFix(entry.fix);
    else this.control(entry.event);
  }

  get distanceModel(): DistanceModel {
    return this.model;
  }

  control(event: ControlEvent): void {
    switch (event.type) {
      case "start":
        if (this.status !== "idle") return;
        this.sport = event.sport;
        this.cfg = SPORT_CONFIG[event.sport];
        this.status = "recording";
        this.startedAt = event.t;
        this.lastCommitT = event.t;
        this.splitBase = { movingMs: 0, t: event.t };
        this.needNewSegment = true;
        return;
      case "pause":
        if (this.status !== "recording") return;
        this.closeOpenHiddenGap(event.t);
        this.status = "paused";
        this.pauseStartedAt = event.t;
        this.needNewSegment = true;
        return;
      case "resume":
        if (this.status !== "paused") return;
        this.pausedMs += Math.max(0, event.t - this.pauseStartedAt);
        this.status = "recording";
        this.hiddenAt = null;
        this.needNewSegment = true;
        return;
      case "hidden":
        if (this.status === "recording" && this.hiddenAt === null) this.hiddenAt = event.t;
        return;
      case "visible":
        // The interruption ends with the next usable fix (or at pause or finish), when its extent is known.
        return;
      case "finish":
        if (this.status === "idle" || this.status === "finished") return;
        if (this.status === "paused") this.pausedMs += Math.max(0, event.t - this.pauseStartedAt);
        else this.closeOpenHiddenGap(event.t);
        this.status = "finished";
        this.endedAt = event.t;
        return;
    }
  }

  addFix(fix: Fix): void {
    if (!validFix(fix)) return;
    this.lastFix = fix;
    if (this.status !== "recording" || this.startedAt === null) return;
    if (fix.t < this.startedAt) return;
    if (this.lastRecordedT !== null && fix.t <= this.lastRecordedT) return;
    this.lastRecordedT = fix.t;
    this.recordedFixes.push(fix);
    this.fixCount++;
    if (fix.acc > this.cfg.maxAccuracyM) {
      this.rejectedAccuracy++;
      return;
    }

    const previous = this.lastAccepted;
    if (this.needNewSegment || !previous) {
      this.startSegment(fix);
      return;
    }

    const interval = fix.t - previous.t;
    const straightLine = haversine(previous, fix);
    const moved = straightLine > Math.max(this.cfg.exitRadiusM, previous.acc + fix.acc);
    const wasHidden = this.hiddenAt !== null && interval > HIDDEN_GAP_MIN_MS;
    const silent = interval > this.cfg.maxFixIntervalMs;

    if (wasHidden || (silent && moved)) {
      const start = wasHidden ? Math.max(previous.t, this.hiddenAt as number) : previous.t;
      this.gaps.push({ kind: wasHidden ? "hidden" : "signal", start, end: fix.t, straightLineM: Math.round(straightLine) });
      this.hiddenAt = null;
      this.jumpCandidates = [];
      if (moved) {
        this.startSegment(fix);
        return;
      }
      // Back where it was: keep the stretch, but none of the untracked time counts as moving.
      this.resetMotion(fix.t);
      this.lastAccepted = { ...fix, speed: null };
    } else {
      this.hiddenAt = null;
      if (this.isJump(previous, fix)) {
        this.rejectedJump++;
        this.handleJump(previous, fix);
        return;
      }
    }
    this.jumpCandidates = [];
    this.process(fix);
  }

  private isJump(from: Fix, to: Fix): boolean {
    const seconds = Math.max(0.5, (to.t - from.t) / 1000);
    const beyondAccuracy = Math.max(0, haversine(from, to) - from.acc - to.acc);
    return beyondAccuracy / seconds > this.cfg.maxSpeedMps;
  }

  private handleJump(previous: Fix, fix: Fix): void {
    const last = this.jumpCandidates[this.jumpCandidates.length - 1];
    if (last && !this.isJump(last, fix)) this.jumpCandidates.push(fix);
    else this.jumpCandidates = [fix];
    if (this.jumpCandidates.length < JUMP_CONFIRMATIONS) return;
    const candidates = this.jumpCandidates;
    this.jumpCandidates = [];
    this.gaps.push({ kind: "jump", start: previous.t, end: candidates[0].t, straightLineM: Math.round(haversine(previous, candidates[0])) });
    this.startSegment(candidates[0]);
    for (const candidate of candidates.slice(1)) this.process(candidate);
  }

  /** Stopped, with nothing pending: the next movement is measured from here. */
  private resetMotion(t: number): void {
    this.lastCommitT = t;
    this.moving = false;
    this.startRun = { count: 0, distance: 0, ms: 0, fromT: t };
    this.lastSpeed = null;
    this.speedSamples = [];
  }

  private startSegment(fix: Fix): void {
    this.needNewSegment = false;
    this.segments.push([]);
    this.acceptedSegments.push([]);
    const r = measurementVariance(fix.acc);
    const speedVariance = this.cfg.maxSpeedMps ** 2 / 4;
    this.smoother = { projection: projector(fix), x: newAxis(r, speedVariance), y: newAxis(r, speedVariance), t: fix.t };
    this.position = { lat: fix.lat, lng: fix.lng };
    const point: RoutePoint = { t: fix.t, lat: fix.lat, lng: fix.lng, d: this.distanceM };
    this.segments[this.segments.length - 1].push(point);
    this.anchor = point;
    this.recentSpeeds = [];
    this.resetMotion(fix.t);
    this.moving = this.model === "position";
    this.altSmoothed = null;
    this.altReference = null;
    this.updateElevation(fix);
    this.noteSpeed(fix);
    this.acceptedSegments[this.acceptedSegments.length - 1].push(fix);
    this.lastAccepted = fix;
    this.acceptedCount++;
    this.routeVersion++;
    this.pushSample(fix.t);
  }

  private smooth(fix: Fix): LatLng {
    const s = this.smoother!;
    const dt = Math.max(0, fix.t - s.t) / 1000;
    const q = this.cfg.accelerationNoise ** 2;
    const r = measurementVariance(fix.acc);
    const { x, y } = s.projection.toXY(fix);
    predictAxis(s.x, dt, q);
    predictAxis(s.y, dt, q);
    updateAxis(s.x, x, r);
    updateAxis(s.y, y, r);
    s.t = fix.t;
    return s.projection.toLatLng(s.x.p, s.y.p);
  }

  private step(fix: Fix): number {
    return Math.min(this.cfg.maxStepM, Math.max(this.cfg.minStepM, fix.acc * this.cfg.stepPerAccuracy));
  }

  /** Speed of the position smoother's estimate, m/s. */
  private smoothedSpeed(): number {
    const s = this.smoother;
    return s ? Math.hypot(s.x.v, s.y.v) : 0;
  }

  private noteSpeed(fix: Fix): void {
    if (fix.speed === null) {
      this.speedStreak = 0;
      this.missingSpeedStreak++;
    } else {
      this.speedStreak++;
      this.missingSpeedStreak = 0;
      this.lastSpeed = { value: fix.speed, t: fix.t };
    }
  }

  private process(fix: Fix): void {
    const previous = this.lastAccepted!;
    const position = this.smooth(fix);
    this.position = position;
    this.updateElevation(fix);
    this.noteSpeed(fix);

    if (this.model === "doppler" && this.missingSpeedStreak * 1000 > DOPPLER_HOLD_MS && fix.t - (this.lastSpeed?.t ?? 0) > DOPPLER_HOLD_MS) {
      this.switchToPosition(fix.t);
    }
    if (this.model === "doppler") this.processDoppler(previous, fix, position);
    else this.processPosition(fix, position);

    this.acceptedSegments[this.acceptedSegments.length - 1].push(fix);
    this.lastAccepted = fix;
    this.acceptedCount++;
    this.pushSample(fix.t);
  }

  /** Back to the position model; distance so far is kept and position steps count from here. */
  private switchToPosition(t: number): void {
    this.model = "position";
    if (this.position) this.pushRoutePoint(this.position, t);
    this.lastCommitT = t;
    this.speedSamples = [];
  }

  /** Position model: commit the smoothed position after a real step; stops need an exit radius. */
  private processPosition(fix: Fix, position: LatLng): void {
    const anchor = this.anchor!;
    const step = this.step(fix);
    const distance = haversine(anchor, position);
    const stopAfter = Math.max(this.cfg.stopAfterMs, (1.5 * step / this.cfg.typicalSpeedMps) * 1000);

    if (this.moving && fix.t - this.lastCommitT > stopAfter) this.moving = false;
    if (this.moving) {
      if (distance >= step) this.commitStep(position, fix.t, distance, fix.t - this.lastCommitT);
    } else if (distance >= Math.max(this.cfg.exitRadiusM, step * 2, fix.acc)) {
      // Moving again. If the average speed since the last step is a moving speed, there was no
      // real stop. Otherwise the time to get here at the smoother's current speed was moving and
      // the rest was the stop.
      const sinceMs = fix.t - this.lastCommitT;
      const average = distance / Math.max(1, sinceMs / 1000);
      const speed = average >= this.cfg.minMovingSpeedMps ? average : Math.max(this.cfg.minMovingSpeedMps, this.smoothedSpeed());
      this.commitStep(position, fix.t, distance, Math.min(sinceMs, (distance / speed) * 1000));
      this.moving = true;
    }

    // Use device speeds from here on once they have arrived steadily (and were never found wrong).
    if (!this.dopplerDisabled && this.speedStreak >= DOPPLER_REQUIRED_FIXES && this.anchor !== anchor) {
      this.model = "doppler";
      this.startRun = { count: 0, distance: 0, ms: 0, fromT: fix.t };
      this.speedSamples = [];
    }
  }

  /** Doppler model: distance is device speed x time while moving; positions only draw the route. */
  private processDoppler(previous: Fix, fix: Fix, position: LatLng): void {
    const dtMs = fix.t - previous.t;
    const held = (t: number) => (this.lastSpeed && t - this.lastSpeed.t <= DOPPLER_HOLD_MS ? this.lastSpeed.value : null);
    const s2 = fix.speed ?? held(fix.t);
    const s1 = previous.speed ?? s2;
    if (s1 === null || s2 === null) {
      this.switchToPosition(fix.t);
      return;
    }
    const speed = (s1 + s2) / 2;
    const travelled = speed * (dtMs / 1000);
    const minimum = this.cfg.minMovingSpeedMps;
    this.recentSpeeds.push(speed);
    if (this.recentSpeeds.length > MAX_SPEED_SAMPLES) this.recentSpeeds.shift();

    if (this.moving) {
      if (speed < minimum * 0.6) this.moving = false;
      else this.addDistance(travelled, dtMs, previous.t, fix.t);
    } else if (speed >= minimum) {
      const run = this.startRun;
      if (run.count === 0) run.fromT = previous.t;
      run.count++;
      run.distance += travelled;
      run.ms += dtMs;
      if (run.count >= 2) {
        // Moving again: count the confirming intervals too.
        this.moving = true;
        this.addDistance(run.distance, run.ms, run.fromT, fix.t);
        this.startRun = { count: 0, distance: 0, ms: 0, fromT: fix.t };
      }
    } else {
      this.startRun = { count: 0, distance: 0, ms: 0, fromT: fix.t };
    }

    if (this.moving && haversine(this.anchor!, position) >= this.step(fix)) this.pushRoutePoint(position, fix.t);
    if (this.moving && this.recentSpeeds.length === MAX_SPEED_SAMPLES) {
      const average = this.recentSpeeds.reduce((sum, value) => sum + value, 0) / MAX_SPEED_SAMPLES;
      if (average <= this.cfg.maxSpeedMps && average > this.maxSpeed) this.maxSpeed = average;
    }

    if (this.speedsLookWrong(fix.t, travelled, position)) {
      this.dopplerDisabled = true;
      this.switchToPosition(fix.t);
      this.moving = false;
    }
  }

  /**
   * Device speeds are dropped for the rest of the recording when they clearly disagree with the
   * positions: far too fast while the position stays put (20 s), or near zero while the position
   * moves far (60 s).
   */
  private speedsLookWrong(t: number, travelled: number, position: LatLng): boolean {
    this.speedTotal += travelled;
    this.speedSamples.push({ t, total: this.speedTotal, position });
    while (this.speedSamples.length > 1 && this.speedSamples[0].t < t - DOPPLER_LOW_WINDOW_MS) this.speedSamples.shift();
    const oldest = this.speedSamples[0];
    let recent = oldest;
    for (let i = this.speedSamples.length - 1; i >= 0 && this.speedSamples[i].t >= t - DOPPLER_HIGH_WINDOW_MS; i--) recent = this.speedSamples[i];
    if (t - recent.t >= DOPPLER_HIGH_WINDOW_MS * 0.75) {
      const claimed = this.speedTotal - recent.total;
      if (claimed > 40 && haversine(recent.position, position) < 0.1 * claimed && this.anchorPathSince(recent.t) < 0.25 * claimed) return true;
    }
    if (t - oldest.t >= DOPPLER_LOW_WINDOW_MS * 0.8) {
      const displacement = haversine(oldest.position, position);
      if (displacement >= 100 && this.speedTotal - oldest.total < 0.3 * displacement) return true;
    }
    return false;
  }

  /** Length of the committed route since time `t` in the current stretch. */
  private anchorPathSince(t: number): number {
    const segment = this.segments[this.segments.length - 1];
    let total = 0;
    for (let i = segment.length - 1; i > 0 && segment[i].t >= t; i--) total += haversine(segment[i - 1], segment[i]);
    return total;
  }

  private commitStep(position: LatLng, t: number, distance: number, movingAddMs: number): void {
    const fromT = this.lastCommitT;
    this.addDistance(distance, movingAddMs, fromT, t);
    this.pushRoutePoint(position, t);
  }

  private pushRoutePoint(position: LatLng, t: number): void {
    const point: RoutePoint = { t, lat: position.lat, lng: position.lng, d: this.distanceM };
    this.segments[this.segments.length - 1].push(point);
    this.anchor = point;
    this.lastCommitT = t;
    this.routeVersion++;
  }

  /** Adds travelled distance and moving time between `fromT` and `t`, closing kilometre splits. */
  private addDistance(distance: number, movingAddMs: number, fromT: number, t: number): void {
    const before = { d: this.distanceM, movingMs: this.movingMs };
    this.distanceM += Math.max(0, distance);
    this.movingMs += Math.max(0, movingAddMs);
    while (this.distanceM >= (this.splits.length + 1) * SPLIT_M) {
      const boundary = (this.splits.length + 1) * SPLIT_M;
      const f = distance > 0 ? Math.min(1, Math.max(0, (boundary - before.d) / distance)) : 1;
      const crossT = fromT + f * (t - fromT);
      const crossMoving = before.movingMs + f * (this.movingMs - before.movingMs);
      this.splits.push({
        index: this.splits.length + 1,
        distanceM: SPLIT_M,
        movingSeconds: Math.round((crossMoving - this.splitBase.movingMs) / 1000),
        elapsedSeconds: Math.round((crossT - this.splitBase.t) / 1000),
      });
      this.splitBase = { movingMs: crossMoving, t: crossT };
    }
    this.pushSample(t);
  }

  private pushSample(t: number): void {
    const last = this.samples[this.samples.length - 1];
    const sample = { t, d: this.distanceM, segment: this.segments.length - 1 };
    if (last && last.t === t) this.samples[this.samples.length - 1] = sample;
    else this.samples.push(sample);
    while (this.samples.length > 2 && this.samples[0].t < t - SAMPLE_RETENTION_MS) this.samples.shift();
  }

  /** Distance over time in the trailing window, within the current stretch; null if too short. */
  private windowSpeed(now: number, windowMs: number, minSpanMs: number): number | null {
    const latest = this.samples[this.samples.length - 1];
    if (!latest) return null;
    let oldest: Sample | null = null;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const sample = this.samples[i];
      if (sample.segment !== latest.segment || sample.t < now - windowMs) break;
      oldest = sample;
    }
    if (!oldest) return null;
    const span = now - oldest.t;
    if (span < minSpanMs) return null;
    return (this.distanceM - oldest.d) / (span / 1000);
  }

  private updateElevation(fix: Fix): void {
    if (fix.alt === null || !Number.isFinite(fix.alt)) return;
    if (fix.altAcc !== null && fix.altAcc > MAX_VERTICAL_ACCURACY_M) return;
    this.altSmoothed = this.altSmoothed === null ? fix.alt : this.altSmoothed + 0.25 * (fix.alt - this.altSmoothed);
    if (this.altReference === null) {
      this.altReference = this.altSmoothed;
      return;
    }
    this.hasElevation = true;
    if (this.altSmoothed > this.altReference + ELEVATION_HYSTERESIS_M) {
      this.elevationGain += this.altSmoothed - this.altReference;
      this.altReference = this.altSmoothed;
    } else if (this.altSmoothed < this.altReference - ELEVATION_HYSTERESIS_M) {
      this.altReference = this.altSmoothed;
    }
  }

  private closeOpenHiddenGap(t: number): void {
    if (this.hiddenAt === null) return;
    const start = Math.max(this.hiddenAt, this.lastAccepted?.t ?? this.hiddenAt);
    if (t - start > HIDDEN_GAP_MIN_MS) this.gaps.push({ kind: "hidden", start, end: t, straightLineM: null });
    this.hiddenAt = null;
    this.needNewSegment = true;
  }

  /** Kilometre splits plus the final part (when at least 10 m), for display and calories. */
  allSplits(): Split[] {
    const parts = this.splits.slice();
    const remainder = this.distanceM - this.splits.length * SPLIT_M;
    if (remainder >= 10) {
      const end = this.endedAt ?? Math.max(this.lastCommitT, this.lastAccepted?.t ?? 0);
      parts.push({
        index: this.splits.length + 1,
        distanceM: Math.round(remainder * 10) / 10,
        movingSeconds: Math.max(0, Math.round((this.movingMs - this.splitBase.movingMs) / 1000)),
        elapsedSeconds: Math.max(0, Math.round((end - this.splitBase.t) / 1000)),
      });
    }
    return parts;
  }

  /** Estimated kcal so far (null without a usable weight). */
  kcal(weightKg: unknown): number | null {
    return estimateKcal(this.sport, this.allSplits(), weightKg);
  }

  snapshot(now: number): EngineSnapshot {
    const started = this.startedAt;
    const end = this.status === "finished" ? (this.endedAt as number) : now;
    const elapsedMs = started === null ? 0 : Math.max(0, end - started);
    const pausedMs = this.pausedMs + (this.status === "paused" ? Math.max(0, now - this.pauseStartedAt) : 0);
    const movingSeconds = this.movingMs / 1000;
    const avgSpeed = movingSeconds > 0 ? this.distanceM / movingSeconds : null;
    let current: number | null = null;
    if (this.status === "recording") {
      if (!this.moving) current = 0;
      else current = this.windowSpeed(now, this.cfg.liveWindowMs, Math.min(10_000, this.cfg.liveWindowMs * 0.5));
    }
    const gapSeconds = this.gaps.reduce((sum, gap) => sum + Math.max(0, gap.end - gap.start), 0) / 1000;
    return {
      status: this.status,
      sport: this.sport,
      startedAt: started,
      endedAt: this.endedAt,
      elapsedSeconds: elapsedMs / 1000,
      activeSeconds: Math.max(0, elapsedMs - pausedMs) / 1000,
      pausedSeconds: pausedMs / 1000,
      movingSeconds,
      distanceM: this.distanceM,
      avgSpeedMps: avgSpeed,
      avgPaceSecondsPerKm: avgSpeed && this.distanceM >= 10 ? 1000 / avgSpeed : null,
      currentSpeedMps: current,
      currentPaceSecondsPerKm: current !== null && current >= this.cfg.minMovingSpeedMps ? 1000 / current : null,
      maxSpeedMps: this.maxSpeed > 0 ? this.maxSpeed : null,
      elevationGainM: this.hasElevation ? Math.round(this.elevationGain) : null,
      stopped: this.status === "recording" && !this.moving,
      distanceModel: this.model,
      splits: this.allSplits(),
      gaps: this.gaps.slice(),
      gapSeconds,
      segments: this.segments,
      routeVersion: this.routeVersion,
      lastFix: this.lastFix,
      fixCount: this.fixCount,
      acceptedCount: this.acceptedCount,
      rejectedAccuracyCount: this.rejectedAccuracy,
      rejectedJumpCount: this.rejectedJump,
    };
  }
}
