/**
 * The timed captions of each exercise's demonstration: one phase per moment of the movement (the start,
 * the way down, the turnaround, the way back), each with a short caption and one technique line. The
 * demonstration player shows the photo for the phase's position and changes caption exactly at each
 * phase boundary, so the words always describe what is on screen. Plain data and maths, so tests can
 * check the timing.
 */
import type { ExerciseId } from "@/lib/form-rules/types";

export interface DemoPhase {
  /** A few words, shown large. */
  caption: string;
  /** One technique line, shown under it. */
  detail: string;
  ms: number;
  /** The position this phase ends in. */
  frame: "start" | "end";
  /** The body moves during this phase (from the previous phase's position to `frame`). */
  move: boolean;
}

export interface DemoScript {
  phases: readonly DemoPhase[];
  totalMs: number;
}

type Words = readonly [caption: string, detail: string];
/** Rep exercises: start, way out, turnaround, way back. */
type RepWords = readonly [Words, Words, Words, Words];
/** Holds: getting set, holding, breathing. */
type HoldWords = readonly [Words, Words, Words];

/** Milliseconds for the start, the way out, the turnaround and the way back. */
type Tempo = readonly [number, number, number, number];
const STEADY: Tempo = [1200, 1400, 600, 1300];
const BRISK: Tempo = [700, 500, 250, 500];

const REPS: Partial<Record<ExerciseId, { words: RepWords; tempo?: Tempo }>> = {
  push_up: { words: [["Plank, arms straight", "Hands under shoulders, body in one line"], ["Lower with control", "Elbows back at about 45 degrees"], ["Chest near the floor", "Hips stay in line"], ["Press back up", "Finish with straight arms"]] },
  bodyweight_squat: { words: [["Stand tall", "Feet hip-width, chest up"], ["Sit back and down", "Hips back, knees over toes"], ["Thighs towards level", "Weight through the middle of your feet"], ["Drive up", "Stand all the way up"]] },
  split_squat: { words: [["Split stance", "Long stance, torso tall"], ["Lower straight down", "Front knee over the ankle"], ["Back knee near the floor", "Both knees near a right angle"], ["Rise", "Push through the front heel"]] },
  glute_bridge: { words: [["Lie back, knees bent", "Feet flat under your knees"], ["Drive your hips up", "Push through your heels"], ["Hold the top", "Shoulders, hips and knees in line"], ["Lower slowly", "Ribs down all the way"]] },
  jumping_jack: { words: [["Feet together", "Arms by your sides"], ["Jump wide", "Land softly, feet wide"], ["Arms overhead", "Hands meet above your head"], ["Back together", "Keep a steady rhythm"]], tempo: [450, 380, 200, 380] },
  reverse_lunge: { words: [["Stand tall", "Feet together under your hips"], ["Step back long", "Lower straight down"], ["Back knee near the floor", "Torso stays upright"], ["Drive up", "Bring your feet together"]] },
  high_knees: { words: [["Stand tall", "Arms ready to drive"], ["Drive a knee up", "Up to hip height"], ["Switch legs", "Quick, light feet"], ["Keep going", "Stay upright"]], tempo: [500, 300, 150, 300] },
  mountain_climber: { words: [["High plank", "Hands under your shoulders"], ["Knee to chest", "Drive it in under you"], ["Switch", "Hips stay level"], ["Keep going", "Steady breathing"]], tempo: BRISK },
  superman: { words: [["Lie face down", "Arms reaching forward"], ["Lift chest and legs", "Both ends together"], ["Hold", "Eyes on the floor"], ["Lower", "All the way down"]] },
  shoulder_press: { words: [["Weights at shoulders", "Wrists over elbows"], ["Press straight up", "Ribs down"], ["Arms straight overhead", "Weights over your shoulders"], ["Lower to shoulders", "Slow and controlled"]] },
  biceps_curl: { words: [["Arms long", "Elbows at your sides"], ["Curl up", "Only the forearm moves"], ["Squeeze at the top", "Elbows stay put"], ["Lower slowly", "All the way to straight"]] },
  lateral_raise: { words: [["Weights by your sides", "Soft bend in the elbows"], ["Raise out to the sides", "Lead with your elbows"], ["Shoulder height", "No higher"], ["Lower slowly", "Back to your sides"]] },
  front_raise: { words: [["Weights at your thighs", "Arms long"], ["Raise in front", "No swinging"], ["Shoulder height", "Arms level with shoulders"], ["Lower slowly", "Back to your thighs"]] },
  triceps_extension: { words: [["Arms straight overhead", "Weight in both hands"], ["Lower behind your head", "Only the elbows bend"], ["Elbows point up", "Upper arms still"], ["Press to straight", "Ribs down"]] },
  romanian_deadlift: { words: [["Stand tall", "Weight in front of your thighs"], ["Hips back", "Soft knees, long back"], ["Feel the stretch", "Weight close to your legs"], ["Stand tall again", "Squeeze your glutes"]] },
  bent_over_row: { words: [["Hinge forward", "Flat back, arms hanging"], ["Pull elbows back", "Past your body"], ["Squeeze", "Shoulder blades together"], ["Lower to straight arms", "Stay hinged"]] },
  sit_up: { words: [["Lie back, knees bent", "Feet flat on the floor"], ["Curl up", "Chin tucked, hands light"], ["Sit tall", "All the way up"], ["Lower with control", "Shoulders to the floor"]] },
};

const HOLDS: Partial<Record<ExerciseId, HoldWords>> = {
  plank: [["Get into position", "Hands under your shoulders"], ["Hold one straight line", "Squeeze your glutes"], ["Breathe", "Hips stay level"]],
  side_plank: [["Get into position", "Support under your shoulder"], ["Lift your hips", "One straight line"], ["Breathe", "Hold it steady"]],
  wall_sit: [["Back on the wall", "Feet a step out"], ["Slide down", "Thighs level with the floor"], ["Hold", "Knees over ankles"]],
};

/** The demonstration script for an exercise, or null when it has none. */
export function demoScript(id: ExerciseId): DemoScript | null {
  const reps = REPS[id];
  if (reps) {
    const [start, out, turn, back] = reps.words;
    const tempo = reps.tempo ?? STEADY;
    const phases: DemoPhase[] = [
      { caption: start[0], detail: start[1], ms: tempo[0], frame: "start", move: false },
      { caption: out[0], detail: out[1], ms: tempo[1], frame: "end", move: true },
      { caption: turn[0], detail: turn[1], ms: tempo[2], frame: "end", move: false },
      { caption: back[0], detail: back[1], ms: tempo[3], frame: "start", move: true },
    ];
    return { phases, totalMs: phases.reduce((sum, phase) => sum + phase.ms, 0) };
  }
  const hold = HOLDS[id];
  if (hold) {
    const phases: DemoPhase[] = hold.map(([caption, detail], index) => ({ caption, detail, ms: index === 0 ? 1600 : 2200, frame: "start" as const, move: false }));
    return { phases, totalMs: phases.reduce((sum, phase) => sum + phase.ms, 0) };
  }
  return null;
}

export interface DemoMoment {
  index: number;
  phase: DemoPhase;
  /** How far through the phase, 0..1. */
  progress: number;
  /** How much of the `end` photo shows, 0..1, eased through each move. */
  mix: number;
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

/** The moment `t` ms into the demonstration, looping when `loop` is on (else held at the last moment). */
export function momentAt(script: DemoScript, t: number, loop = true): DemoMoment {
  const total = script.totalMs;
  let time = Math.max(0, t);
  if (loop) time %= total;
  else if (time >= total) time = total - 1e-6;
  let cursor = 0;
  for (let index = 0; index < script.phases.length; index += 1) {
    const phase = script.phases[index];
    if (time < cursor + phase.ms || index === script.phases.length - 1) {
      const progress = Math.min(1, Math.max(0, (time - cursor) / phase.ms));
      const previous = script.phases[(index - 1 + script.phases.length) % script.phases.length];
      const from = previous.frame === "end" ? 1 : 0;
      const to = phase.frame === "end" ? 1 : 0;
      const mix = phase.move ? from + (to - from) * easeInOut(progress) : to;
      return { index, phase, progress, mix };
    }
    cursor += phase.ms;
  }
  // Unreachable: the loop always returns on the last phase.
  return { index: 0, phase: script.phases[0], progress: 0, mix: 0 };
}

/** Milliseconds from the demonstration's start to the beginning of phase `index`. */
export function phaseStart(script: DemoScript, index: number): number {
  return script.phases.slice(0, Math.max(0, Math.min(index, script.phases.length))).reduce((sum, phase) => sum + phase.ms, 0);
}
