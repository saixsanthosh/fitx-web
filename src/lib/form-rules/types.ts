/**
 * Form rules as data. Each supported exercise describes which joint measurements to take, the
 * thresholds (with hysteresis) that make a rep, and the posture cues to give. The engine in
 * ./session.ts runs any rule; tuning an exercise means editing numbers in ./catalog.ts only.
 */
import type { Joint } from "@/lib/pose/landmarks";

/** Exercise ids match public.exercise_library ids. */
export type ExerciseId = "push_up" | "bodyweight_squat" | "split_squat" | "glute_bridge" | "plank" | "jumping_jack";

/**
 * Which body side a measurement uses.
 * - "visible": the side the camera sees best (side-on exercises; the far side is hidden by the body)
 * - "both-min" / "both-max": both sides must be seen; the smaller / larger value is used
 */
export type SideMode = "visible" | "both-min" | "both-max";

/** A measurement taken from the landmarks on every frame. */
export type MetricSpec =
  /**
   * The angle at the middle joint, in degrees (180 = straight). With `signed`, a middle joint that
   * rises above the line through the outer two reads past 180 (e.g. 195 = hips pushed 15° past
   * straight in a bridge), so "not high enough" and "over-arched" are never confused.
   */
  | { kind: "angle"; joints: readonly [Joint, Joint, Joint]; side: SideMode; signed?: boolean }
  /** How far the segment from → to leans from vertical or horizontal, in degrees. */
  | { kind: "tilt"; from: Joint; to: Joint; reference: "vertical" | "horizontal"; side: SideMode }
  /** Signed distance of `point` from the line from → to, as a fraction of its length (+ = below the line). */
  | { kind: "lineOffset"; from: Joint; to: Joint; point: Joint; side: SideMode }
  /** How far `upper` sits above `lower`, as a fraction of the lower → upper distance (1 = straight above). */
  | { kind: "rise"; lower: Joint; upper: Joint; side: SideMode }
  /** Horizontal gap between the left and right `joint`, as a multiple of the gap between the left and right `reference`. */
  | { kind: "spread"; joint: Joint; reference: Joint };

export interface Condition {
  metric: string;
  op: "<=" | ">=";
  value: number;
}

/** A position with hysteresis: entered when every `enter` condition holds, left when any `exit` condition holds. */
export interface PhaseSpec {
  enter: readonly Condition[];
  exit: readonly Condition[];
}

export interface CueText {
  /** Shown on screen. */
  text: string;
  /** Spoken when voice cues are on: short, so it lands mid-rep. */
  speech: string;
}

/** The phases of one rep, from the start position out to the turnaround and back. */
export type RepPhase = "idle" | "start" | "outbound" | "target" | "inbound";

export interface RepMotion {
  kind: "reps";
  /** Where every rep begins and ends: arms straight at the top of a push-up, standing tall. */
  start: PhaseSpec;
  /** The turnaround a full rep must reach: the bottom of a push-up, hips up in a bridge. */
  target: PhaseSpec;
  /** Drives the depth meter: `from` at the start position, `to` at a full rep. */
  progress: { metric: string; from: number; to: number };
  /** Going at least this share of the way and coming back without reaching the target is a partial rep. */
  partialFloor: number;
  /** Faster round trips are tracking noise, not reps. */
  minRepMs: number;
  /** A rep that takes longer than this is abandoned. */
  maxRepMs: number;
  /** Shown while the user is in position but not yet at the start of a rep. */
  startHint: string;
  /** Shown when a rep stops short of the target. */
  partialCue: CueText;
  /** Shown when the user heads back to the target before reaching the start position again. */
  lockoutCue?: CueText;
}

/** A timed hold. Being in position is the rule's `posture`; the timer only runs while `form` also holds. */
export interface HoldMotion {
  kind: "hold";
  /** Good form: the hold timer runs while all of these hold. */
  form: readonly Condition[];
  /** A form break shorter than this does not stop the timer (tracking jitter, not a real break). */
  formGraceMs: number;
}

export interface CueSpec extends CueText {
  id: string;
  /** The fault is present while every condition holds. */
  when: readonly Condition[];
  /** Rep exercises: the phases in which the fault is checked (default: any moving phase). */
  during?: readonly RepPhase[];
  /** The fault must last this long before it is reported. */
  sustainMs: number;
}

export interface ExerciseRule {
  id: ExerciseId;
  name: string;
  /** "side" = side-on to the camera, "front" = facing it. */
  view: "side" | "front";
  /** One line on what the camera checks, shown before starting. */
  checks: string;
  /** Camera placement, in order. */
  setupTips: readonly string[];
  /** What a single 2D camera view cannot judge for this exercise. */
  limits: string;
  /** Joints that must be seen clearly for counting (on the seen side, or both sides for "front"). */
  required: readonly Joint[];
  /** Landmarks below this visibility count as not seen. */
  minVisibility: number;
  metrics: Readonly<Record<string, MetricSpec>>;
  /** Body position needed before counting starts (lying vs standing). */
  posture: readonly Condition[];
  /** Shown while the posture does not match. */
  postureHint: string;
  motion: RepMotion | HoldMotion;
  /** Form cues, most important first. */
  cues: readonly CueSpec[];
  /** One Euro smoothing for this exercise's measurements (faster moves need less smoothing). */
  smoothing: { minCutoff: number; beta: number };
  /** exercise_library ids this rule counts. */
  libraryIds: readonly string[];
  /** Exercise names (normalised: lower case, letters and digits) this rule counts. */
  names: readonly string[];
}
