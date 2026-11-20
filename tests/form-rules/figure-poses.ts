/**
 * Posable bodies for the newer camera exercises (test-only). Each builder starts from the
 * exercise's own demonstration poses (src/lib/home-workout/demos.ts) and bends them by a fraction
 * `k` (0 = start position, 1 = a full rep) plus the fault being tested, then writes the figure out
 * as camera frames through ./synthetic.ts.
 */
import { DEMONSTRATIONS } from "@/lib/home-workout/demos";
import type { Demonstration, FigurePoints, FigurePose, Limbs } from "@/lib/home-workout/figure";
import { blendPose, place } from "@/lib/home-workout/figure";
import type { ExerciseId } from "@/lib/form-rules/types";
import type { RepPlan, SequenceOptions } from "./synthetic";
import { figureSequence, LANDSCAPE, planDuration, PORTRAIT, repValueAt } from "./synthetic";

const demo = (id: ExerciseId): Demonstration => DEMONSTRATIONS[id];
const pose = (id: ExerciseId, index: number): FigurePose => demo(id).keyframes[index].pose;
const at = (id: ExerciseId, index: number) => demo(id).keyframes[index].at ?? demo(id).at;
const draw = (id: ExerciseId, figure: FigurePose, index = 0): FigurePoints => place(demo(id), figure, at(id, index));
const withLimbs = (limbs: Limbs, patch: Partial<Limbs>): Limbs => ({ ...limbs, ...patch });

export function reverseLunge(k: number, options: { lean?: number } = {}): FigurePoints {
  const figure = blendPose(pose("reverse_lunge", 0), pose("reverse_lunge", 1), k);
  return draw("reverse_lunge", { ...figure, torso: figure.torso + (options.lean ?? 0) * k });
}

/** One knee lifted by `k` (the near knee, or the far one with `far`); `lean` tips the torso sideways as it lifts. */
export function highKnees(k: number, options: { far?: boolean; lean?: number } = {}): FigurePoints {
  const figure = blendPose(pose("high_knees", 0), pose("high_knees", options.far ? 3 : 1), k);
  return draw("high_knees", { ...figure, torso: figure.torso - (options.lean ?? 0) * k });
}

/** The near knee driven in by `k`; `torso` replaces the plank's torso direction (hip sag or pike). */
export function mountainClimber(k: number, options: { torso?: number } = {}): FigurePoints {
  const figure = blendPose(pose("mountain_climber", 0), pose("mountain_climber", 1), k);
  if (options.torso === undefined) return draw("mountain_climber", figure);
  const legs = options.torso + 180;
  return draw("mountain_climber", {
    ...figure,
    torso: options.torso,
    far: withLimbs(figure.far, { thigh: legs, shin: legs }),
    near: k === 0 ? withLimbs(figure.near, { thigh: legs, shin: legs }) : figure.near,
  });
}

/** A side plank with the hips bent `bend` degrees out of line (+ = dropping towards the floor). */
export function sidePlank(bend = 0): FigurePoints {
  const base = pose("side_plank", 0);
  const legs = 166 + bend;
  return draw("side_plank", { ...base, torso: base.torso - bend, near: withLimbs(base.near, { thigh: legs, shin: legs }), far: withLimbs(base.far, { thigh: legs, shin: legs }) });
}

/** `k` 0 standing, 1 seated with thighs level; `thigh` overrides the thigh direction (0 = level), `lean` tips the torso forward. */
export function wallSit(k: number, options: { thigh?: number; lean?: number } = {}): FigurePoints {
  const figure = blendPose(pose("wall_sit", 0), pose("wall_sit", 1), k);
  const thigh = options.thigh;
  return draw("wall_sit", {
    ...figure,
    torso: figure.torso + (options.lean ?? 0),
    near: thigh === undefined ? figure.near : withLimbs(figure.near, { thigh }),
    far: thigh === undefined ? figure.far : withLimbs(figure.far, { thigh }),
  });
}

/** Lying face down with the chest raised `chest` degrees and the legs `legs` degrees. */
export function superman(chest: number, legs: number): FigurePoints {
  const base = pose("superman", 0);
  const side = (limbs: Limbs) => withLimbs(limbs, { upperArm: 2 - chest, forearm: -chest, thigh: 180 + legs, shin: 180 + legs, foot: 182 + legs });
  return draw("superman", { ...base, torso: -chest, near: side(base.near), far: side(base.far) });
}

/** `k` 0 weights at the shoulders, 1 pressed overhead; `farK` presses the far arm by its own amount; `lean` leans back. */
export function shoulderPress(k: number, options: { farK?: number; lean?: number } = {}): FigurePoints {
  const near = blendPose(pose("shoulder_press", 0), pose("shoulder_press", 1), k);
  const far = blendPose(pose("shoulder_press", 0), pose("shoulder_press", 1), options.farK ?? k);
  return draw("shoulder_press", { ...near, far: far.far, torso: near.torso - (options.lean ?? 0) * k });
}

/** `k` 0 arms hanging, 1 curled; `drift` swings the upper arm forward and `swing` leans the torso back, both by `k`. */
export function bicepsCurl(k: number, options: { drift?: number; swing?: number } = {}): FigurePoints {
  const figure = blendPose(pose("biceps_curl", 0), pose("biceps_curl", 1), k);
  const drift = (options.drift ?? 0) * k;
  const arm = (limbs: Limbs) => withLimbs(limbs, { upperArm: limbs.upperArm - drift, forearm: limbs.forearm - drift });
  return draw("biceps_curl", { ...figure, torso: figure.torso - (options.swing ?? 0) * k, near: arm(figure.near), far: arm(figure.far) });
}

/** Frames for a rep plan whose value is the blend `k` handed to `body`. */
export function planFrames(id: ExerciseId, plan: RepPlan, body: (k: number, t: number) => FigurePoints, options: SequenceOptions = {}) {
  const view = demo(id).view;
  const landscape = id === "mountain_climber" || id === "superman" || id === "side_plank";
  return figureSequence(planDuration(plan), view, (t) => body(repValueAt(plan, t), t), { aspect: landscape ? LANDSCAPE : PORTRAIT, ...options });
}

/** Frames of a still pose (holds), sampled like `sequence`. */
export function holdFrames(id: ExerciseId, durationMs: number, body: (t: number) => FigurePoints, options: SequenceOptions = {}) {
  const landscape = id === "mountain_climber" || id === "superman" || id === "side_plank";
  return figureSequence(durationMs, demo(id).view, body, { aspect: landscape ? LANDSCAPE : PORTRAIT, ...options });
}
