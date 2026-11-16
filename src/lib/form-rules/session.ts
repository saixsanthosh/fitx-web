/**
 * Runs one exercise rule over a stream of pose frames: counts reps (or times a hold), raises
 * posture cues, and says plainly when the camera can't see enough to count. Pure logic with no
 * browser APIs, so the same code runs in the app and in the synthetic-motion tests.
 *
 * Honesty rules:
 * - Nothing is counted from frames where a required joint is not seen clearly.
 * - A rep in progress when the camera loses the user for longer than `lossGraceMs` is dropped,
 *   not guessed.
 * - A rep that stops short of the target is reported as partial and not counted.
 */
import type { Joint, PoseFrame, Side } from "@/lib/pose/landmarks";
import { OneEuroFilter } from "@/lib/pose/smoothing";
import { allHold, anyHolds, readFrame } from "./metrics";
import type { CueSpec, CueText, ExerciseId, ExerciseRule, MetricSpec, RepMotion, RepPhase } from "./types";

/**
 * - "searching": no person in view
 * - "unclear": a person, but a joint the rule needs is not seen clearly (nothing is counted)
 * - "position": seen clearly, but not yet in the exercise position (or facing the wrong way)
 * - "active": counting or timing
 */
export type CoachStatus = "searching" | "unclear" | "position" | "active";

/** Rep phases, or for holds: "holding" (timer running), "adjust" (in position, form off), "resting". */
export type CoachPhase = RepPhase | "holding" | "adjust" | "resting";

export interface ActiveCue extends CueText {
  id: string;
}

export type CoachEvent =
  | { type: "rep"; reps: number; clean: boolean }
  | { type: "partial"; partials: number; cue: ActiveCue }
  | { type: "cue"; cue: ActiveCue }
  | { type: "lost" };

export interface CoachSnapshot {
  t: number;
  status: CoachStatus;
  /** The single most useful instruction right now. */
  guidance: string;
  phase: CoachPhase;
  reps: number;
  /** Reps with no form cue raised during them. */
  cleanReps: number;
  /** Reps started but stopped short of the target (not counted). */
  partials: number;
  /** Plank: time held in good form. */
  holdMs: number;
  /** Plank: time spent in the plank position, good form or not. */
  positionMs: number;
  /** How far through the current rep, 0..1 (null for holds or when unknown). */
  progress: number | null;
  /** The cue to show now, if any. */
  cue: ActiveCue | null;
  side: Side | null;
  /** What happened on this frame (for speech and announcements). */
  events: CoachEvent[];
}

export interface CoachSummary {
  exerciseId: ExerciseId;
  kind: "reps" | "hold";
  reps: number;
  cleanReps: number;
  partials: number;
  holdSeconds: number;
  positionSeconds: number;
  /** From the first counted movement to the end. */
  activeSeconds: number;
  /** Time the camera could not see enough to count (nobody in view, or a needed joint unclear). */
  unclearSeconds: number;
  /** Form cues raised, most frequent first. */
  cues: Array<{ id: string; text: string; count: number }>;
}

export interface CoachSessionOptions {
  /** How long the camera may lose the user mid-rep before that rep is dropped. */
  lossGraceMs?: number;
  /** Minimum time between two reports of the same cue, so spoken cues do not nag. */
  cueCooldownMs?: number;
  /** How long a one-off message (partial rep, dropped rep) stays on screen. */
  noticeMs?: number;
  /** A body smaller than this (in image heights) is too far away to measure reliably. */
  minExtent?: number;
}

export interface CoachSession {
  readonly rule: ExerciseRule;
  update(frame: PoseFrame): CoachSnapshot;
  /** The camera stopped (tab hidden, camera lost): drops any rep in progress and stops the clocks. */
  pause(): void;
  summary(): CoachSummary;
}

const MOVING: readonly RepPhase[] = ["outbound", "target", "inbound"];
/** Frame gaps longer than this (a stalled tab, a paused camera) are not added to any clock. */
const MAX_FRAME_GAP_MS = 250;
/** A measurement not seen for this long restarts its smoothing instead of blending with stale values. */
const SMOOTHING_GAP_MS = 300;
/** Leaving the exercise posture between reps for this long means the set is paused. */
const POSTURE_LOSS_MS = 800;
const LOST_NOTICE: ActiveCue = { id: "lost", text: "Lost sight of you, so that rep wasn't counted.", speech: "Rep not counted" };
/**
 * Smoothing works in these units, so one setting suits every measurement: angles in degrees,
 * ratios in hundredths. (A foot-spread ratio moving 8/s must lag as little as an angle moving 500°/s.)
 */
const SMOOTHING_UNIT: Record<MetricSpec["kind"], number> = { angle: 1, tilt: 1, lineOffset: 0.01, rise: 0.01, spread: 0.01 };

const PART: Record<Joint, string> = {
  ear: "head", shoulder: "shoulders", elbow: "elbows", wrist: "hands", hip: "hips", knee: "knees", ankle: "feet", heel: "feet", foot: "feet",
};
/** Body parts in head-to-toe order, so messages read naturally. */
const PART_ORDER = ["head", "shoulders", "elbows", "hands", "hips", "knees", "feet"];

/** Plain-language help for joints the camera can't see clearly. */
export function missingGuidance(missing: readonly Joint[]): string {
  const parts = [...new Set(missing.map((joint) => PART[joint]))].sort((a, b) => PART_ORDER.indexOf(a) - PART_ORDER.indexOf(b));
  if (parts.length === 0) return "";
  if (parts.length >= 3) return "Can't see you clearly. Make sure your whole body is in view, with good light.";
  if (parts.includes("feet") || parts.includes("knees")) return `Can't see your ${list(parts)} clearly. Move back until your whole body is in view.`;
  return `Can't see your ${list(parts)} clearly. Keep ${parts.length === 1 && parts[0] === "head" ? "it" : "them"} in view of the camera.`;
}

function list(parts: string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
}

export function createCoachSession(rule: ExerciseRule, options: CoachSessionOptions = {}): CoachSession {
  const lossGraceMs = options.lossGraceMs ?? 600;
  const cueCooldownMs = options.cueCooldownMs ?? 6000;
  const noticeMs = options.noticeMs ?? 2500;
  const minExtent = options.minExtent ?? 0.2;
  const motion = rule.motion;

  const filters = new Map<string, { filter: OneEuroFilter; lastT: number }>();
  let side: Side | null = null;
  let lastT: number | null = null;

  // Counting state.
  let phase: RepPhase = "idle";
  let reps = 0;
  let cleanReps = 0;
  let partials = 0;
  let repStartedAt = 0;
  let maxProgress = 0;
  let lowestOnReturn = 1;
  let repFaults = new Set<string>();
  let postureLostSince: number | null = null;

  // Hold state.
  let holdMs = 0;
  let positionMs = 0;
  let formBadSince: number | null = null;
  let holdPhase: "holding" | "adjust" | "resting" = "resting";

  // Visibility and timing.
  let lostSince: number | null = null;
  let firstActiveAt: number | null = null;
  let activeEnd = 0;
  let unclearMs = 0;

  // Cues.
  const faultSince = new Map<string, number>();
  const activeFaults = new Set<string>();
  const lastSpoken = new Map<string, number>();
  const cueCounts = new Map<string, number>();
  let notice: { cue: ActiveCue; until: number } | null = null;

  function smooth(values: Record<string, number | undefined>, t: number) {
    const out: Record<string, number | undefined> = {};
    for (const [id, value] of Object.entries(values)) {
      if (value === undefined) {
        out[id] = undefined;
        continue;
      }
      let entry = filters.get(id);
      if (!entry || t - entry.lastT > SMOOTHING_GAP_MS) {
        entry = { filter: new OneEuroFilter(rule.smoothing.minCutoff, rule.smoothing.beta), lastT: t };
        filters.set(id, entry);
      }
      entry.lastT = t;
      const unit = SMOOTHING_UNIT[rule.metrics[id]?.kind ?? "angle"];
      out[id] = entry.filter.filter(value / unit, t) * unit;
    }
    return out;
  }

  function progressOf(values: Record<string, number | undefined>): number | null {
    if (motion.kind !== "reps") return null;
    const value = values[motion.progress.metric];
    if (value === undefined) return null;
    const share = (value - motion.progress.from) / (motion.progress.to - motion.progress.from);
    return Math.min(1, Math.max(0, share));
  }

  function raise(cue: ActiveCue, t: number, events: CoachEvent[]) {
    const last = lastSpoken.get(cue.id);
    if (last === undefined || t - last >= cueCooldownMs) {
      lastSpoken.set(cue.id, t);
      events.push({ type: "cue", cue });
    }
  }

  function showNotice(cue: ActiveCue, t: number) {
    notice = { cue, until: t + noticeMs };
  }

  function clearFaults() {
    faultSince.clear();
    activeFaults.clear();
  }

  /** Checks every cue that applies now; returns the most important active one. */
  function checkCues(values: Record<string, number | undefined>, t: number, inPhase: RepPhase | null, events: CoachEvent[]): ActiveCue | null {
    let shown: ActiveCue | null = null;
    for (const cue of rule.cues) {
      const applies = inPhase === null || (cue.during ?? MOVING).includes(inPhase);
      if (!applies || !allHold(cue.when, values)) {
        faultSince.delete(cue.id);
        activeFaults.delete(cue.id);
        continue;
      }
      const since = faultSince.get(cue.id) ?? t;
      faultSince.set(cue.id, since);
      if (t - since < cue.sustainMs) continue;
      if (!activeFaults.has(cue.id)) {
        activeFaults.add(cue.id);
        cueCounts.set(cue.id, (cueCounts.get(cue.id) ?? 0) + 1);
        raise(asActive(cue), t, events);
      }
      repFaults.add(cue.id);
      shown ??= asActive(cue);
    }
    return shown;
  }

  function dropRep() {
    phase = "idle";
    repFaults = new Set();
    maxProgress = 0;
    lowestOnReturn = 1;
  }

  function beginRep(t: number) {
    phase = "outbound";
    repStartedAt = t;
    maxProgress = 0;
    lowestOnReturn = 1;
    repFaults = new Set();
  }

  function snapshot(t: number, status: CoachStatus, guidance: string, extra: { progress: number | null; cue: ActiveCue | null; events: CoachEvent[] }): CoachSnapshot {
    const showing = notice && t < notice.until ? notice.cue : null;
    if (notice && t >= notice.until) notice = null;
    return {
      t,
      status,
      guidance,
      phase: motion.kind === "reps" ? phase : holdPhase,
      reps,
      cleanReps,
      partials,
      holdMs,
      positionMs,
      progress: extra.progress,
      cue: showing ?? extra.cue,
      side,
      events: extra.events,
    };
  }

  function stepReps(m: RepMotion, values: Record<string, number | undefined>, ready: boolean, t: number, events: CoachEvent[]) {
    const progress = progressOf(values);
    if (phase === "idle") {
      if (ready && allHold(m.start.enter, values)) phase = "start";
    } else if (phase === "start") {
      if (ready) postureLostSince = null;
      else postureLostSince ??= t;
      if (postureLostSince !== null && t - postureLostSince >= POSTURE_LOSS_MS) {
        phase = "idle";
        postureLostSince = null;
      } else if (anyHolds(m.start.exit, values)) {
        // The posture held a moment ago; a rep may start even if the first frames of it bend the torso.
        postureLostSince = null;
        beginRep(t);
      }
    } else if (phase === "outbound") {
      if (progress !== null) maxProgress = Math.max(maxProgress, progress);
      if (allHold(m.target.enter, values)) {
        phase = "target";
      } else if (allHold(m.start.enter, values)) {
        if (maxProgress >= m.partialFloor) {
          partials += 1;
          const cue: ActiveCue = { id: "partial", ...m.partialCue };
          events.push({ type: "partial", partials, cue });
          showNotice(cue, t);
          cueCounts.set("partial", (cueCounts.get("partial") ?? 0) + 1);
        }
        phase = "start";
      }
    } else if (phase === "target") {
      if (anyHolds(m.target.exit, values)) {
        phase = "inbound";
        lowestOnReturn = progress ?? 1;
      }
    } else if (phase === "inbound") {
      if (progress !== null) lowestOnReturn = Math.min(lowestOnReturn, progress);
      if (allHold(m.start.enter, values)) {
        if (t - repStartedAt >= m.minRepMs) {
          reps += 1;
          const clean = repFaults.size === 0;
          if (clean) cleanReps += 1;
          events.push({ type: "rep", reps, clean });
        }
        phase = "start";
        repFaults = new Set();
      } else if (allHold(m.target.enter, values)) {
        if (m.lockoutCue && lowestOnReturn <= 0.5) {
          const cue: ActiveCue = { id: "lockout", ...m.lockoutCue };
          showNotice(cue, t);
          raise(cue, t, events);
          cueCounts.set("lockout", (cueCounts.get("lockout") ?? 0) + 1);
        }
        phase = "target";
        lowestOnReturn = 1;
      }
    }
    if (MOVING.includes(phase) && t - repStartedAt > m.maxRepMs) dropRep();
    return progress;
  }

  function update(frame: PoseFrame): CoachSnapshot {
    const t = frame.t;
    const dt = lastT === null ? 0 : Math.min(MAX_FRAME_GAP_MS, Math.max(0, t - lastT));
    lastT = t;
    const events: CoachEvent[] = [];
    const reading = readFrame(rule, frame, side);
    if (reading.person) side = reading.side;

    let problem: { status: CoachStatus; guidance: string } | null = null;
    if (!reading.person) {
      problem = { status: "searching", guidance: rule.view === "side" ? "Step into view, side-on to the camera." : "Step into view, facing the camera." };
    } else if (reading.missing.length > 0) {
      problem = { status: "unclear", guidance: missingGuidance(reading.missing) };
    } else if (reading.extent !== undefined && reading.extent < minExtent) {
      problem = { status: "unclear", guidance: "You're too far away to measure. Move closer to the camera." };
    }

    if (problem) {
      lostSince ??= t;
      unclearMs += dt;
      clearFaults();
      if (motion.kind === "reps") {
        if (phase !== "idle" && t - lostSince > lossGraceMs) {
          if (MOVING.includes(phase)) {
            events.push({ type: "lost" });
            showNotice(LOST_NOTICE, t);
          }
          dropRep();
        }
      } else {
        holdPhase = "resting";
        formBadSince = null;
      }
      return snapshot(t, problem.status, problem.guidance, { progress: null, cue: null, events });
    }
    lostSince = null;

    const values = smooth(reading.values, t);
    const viewOk = rule.view === "side"
      ? reading.facing === undefined || reading.facing <= 0.65
      : reading.facing !== undefined && reading.facing >= 0.55;
    const postureOk = allHold(rule.posture, values);
    const viewHint = rule.view === "side" ? "Turn side-on to the camera." : "Face the camera.";

    if (motion.kind === "hold") {
      const inPosition = viewOk && postureOk;
      if (!inPosition) {
        holdPhase = "resting";
        formBadSince = null;
        clearFaults();
        return snapshot(t, "position", viewOk ? rule.postureHint : viewHint, { progress: null, cue: null, events });
      }
      firstActiveAt ??= t;
      activeEnd = t;
      positionMs += dt;
      const formOk = allHold(motion.form, values);
      if (formOk) formBadSince = null;
      else formBadSince ??= t;
      const holding = formOk || (formBadSince !== null && t - formBadSince < motion.formGraceMs);
      if (holding) holdMs += dt;
      holdPhase = holding ? "holding" : "adjust";
      const cue = checkCues(values, t, null, events);
      return snapshot(t, "active", holding ? "Hold steady in one straight line." : "Straighten your body line to keep the timer running.", { progress: null, cue, events });
    }

    const ready = viewOk && postureOk;
    const progress = stepReps(motion, values, ready, t, events);
    if (phase === "idle") {
      clearFaults();
      const guidance = !viewOk ? viewHint : !postureOk ? rule.postureHint : motion.startHint;
      return snapshot(t, "position", guidance, { progress: null, cue: null, events });
    }
    firstActiveAt ??= t;
    activeEnd = t;
    const moving = MOVING.includes(phase);
    if (!moving) clearFaults();
    const cue = moving ? checkCues(values, t, phase, events) : null;
    const guidance = phase === "start" && reps === 0 && partials === 0 ? "Ready. Start whenever you like." : "Counting.";
    return snapshot(t, "active", guidance, { progress: moving ? progress : 0, cue, events });
  }

  function pause() {
    if (motion.kind === "reps") dropRep();
    holdPhase = "resting";
    formBadSince = null;
    postureLostSince = null;
    lostSince = null;
    lastT = null;
    filters.clear();
    clearFaults();
    notice = null;
  }

  function summary(): CoachSummary {
    const texts = new Map<string, string>(rule.cues.map((cue) => [cue.id, cue.text]));
    if (motion.kind === "reps") {
      texts.set("partial", motion.partialCue.text);
      if (motion.lockoutCue) texts.set("lockout", motion.lockoutCue.text);
    }
    return {
      exerciseId: rule.id,
      kind: motion.kind,
      reps,
      cleanReps,
      partials,
      holdSeconds: Math.floor(holdMs / 1000),
      positionSeconds: Math.floor(positionMs / 1000),
      activeSeconds: firstActiveAt === null ? 0 : Math.round((activeEnd - firstActiveAt) / 1000),
      unclearSeconds: Math.round(unclearMs / 1000),
      cues: [...cueCounts.entries()]
        .map(([id, count]) => ({ id, text: texts.get(id) ?? id, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  return { rule, update, pause, summary };
}

function asActive(cue: CueSpec): ActiveCue {
  return { id: cue.id, text: cue.text, speech: cue.speech };
}
