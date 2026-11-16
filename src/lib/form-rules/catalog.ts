/**
 * The six exercises the camera coach supports, as data. Angles are in degrees measured on the
 * 2D image; "offset" values are fractions of the body line they are measured against.
 *
 * Each pair of thresholds leaves a gap (hysteresis), so a joint wobbling around one number can
 * never produce extra reps. Changing how strict an exercise is means changing numbers here; the
 * synthetic-motion tests in tests/form-rules/ show what each change does.
 */
import type { ExerciseId, ExerciseRule } from "./types";

const pushUp: ExerciseRule = {
  id: "push_up",
  name: "Push-up",
  view: "side",
  checks: "Counts reps from your elbow angle and watches that your hips stay in one line with your shoulders and ankles.",
  setupTips: [
    "Turn your phone sideways and stand it on the floor, about 2 metres away.",
    "Get side-on to the camera so it sees your head, hands and feet.",
    "Start at the top with straight arms.",
  ],
  limits: "One camera sees you from one side only, so it can't judge hand width or elbow flare. Hip cues assume full push-ups from your toes.",
  required: ["shoulder", "elbow", "wrist", "hip", "ankle"],
  minVisibility: 0.6,
  metrics: {
    elbow: { kind: "angle", joints: ["shoulder", "elbow", "wrist"], side: "visible" },
    body: { kind: "tilt", from: "shoulder", to: "ankle", reference: "horizontal", side: "visible" },
    hips: { kind: "lineOffset", from: "shoulder", to: "ankle", point: "hip", side: "visible" },
  },
  posture: [{ metric: "body", op: "<=", value: 35 }],
  postureHint: "Get into a high plank, side-on to the camera.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "elbow", op: ">=", value: 150 }], exit: [{ metric: "elbow", op: "<=", value: 140 }] },
    target: { enter: [{ metric: "elbow", op: "<=", value: 100 }], exit: [{ metric: "elbow", op: ">=", value: 110 }] },
    progress: { metric: "elbow", from: 160, to: 90 },
    partialFloor: 0.3,
    minRepMs: 600,
    maxRepMs: 20_000,
    startHint: "Straighten your arms to start.",
    partialCue: { text: "Lower your chest closer to the floor for the rep to count.", speech: "Go lower" },
    lockoutCue: { text: "Push all the way up to straight arms.", speech: "All the way up" },
  },
  cues: [
    { id: "hip_sag", text: "Hips are sagging. Squeeze your glutes and brace your stomach.", speech: "Lift your hips", when: [{ metric: "hips", op: ">=", value: 0.07 }], sustainMs: 400 },
    { id: "hip_pike", text: "Hips are too high. Lower them into one straight line.", speech: "Hips down", when: [{ metric: "hips", op: "<=", value: -0.1 }], sustainMs: 400 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  libraryIds: [
    "push_up",
    "free-exercise-db-Pushups",
    "free-exercise-db-Push-Up_Wide",
    "free-exercise-db-Push-Ups_-_Close_Triceps_Position",
    "free-exercise-db-Pushups_Close_and_Wide_Hand_Positions",
    "free-exercise-db-Push-Ups_With_Feet_Elevated",
    "free-exercise-db-Decline_Push-Up",
  ],
  names: ["pushup", "pushups", "wide pushup", "wide pushups", "close grip pushup", "close grip pushups", "decline pushup", "decline pushups"],
};

const bodyweightSquat: ExerciseRule = {
  id: "bodyweight_squat",
  name: "Bodyweight squat",
  view: "side",
  checks: "Counts reps from your knee angle and checks that your chest stays up as you sit down.",
  setupTips: [
    "Stand the phone upright at hip height, about 2 to 3 metres away.",
    "Turn side-on so the camera sees one hip, knee and ankle clearly.",
    "Start standing tall with your whole body in view.",
  ],
  limits: "From the side the camera can't see your knees moving inwards; a front view would be needed for that.",
  required: ["shoulder", "hip", "knee", "ankle"],
  minVisibility: 0.6,
  metrics: {
    knee: { kind: "angle", joints: ["hip", "knee", "ankle"], side: "visible" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [{ metric: "torso", op: "<=", value: 30 }],
  postureHint: "Stand tall, side-on to the camera.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "knee", op: ">=", value: 160 }], exit: [{ metric: "knee", op: "<=", value: 150 }] },
    target: { enter: [{ metric: "knee", op: "<=", value: 110 }], exit: [{ metric: "knee", op: ">=", value: 120 }] },
    progress: { metric: "knee", from: 170, to: 100 },
    partialFloor: 0.3,
    minRepMs: 700,
    maxRepMs: 20_000,
    startHint: "Stand tall to start.",
    partialCue: { text: "Sit a little deeper, towards thighs level with the floor.", speech: "Deeper" },
    lockoutCue: { text: "Stand all the way up between reps.", speech: "Stand tall" },
  },
  cues: [
    { id: "chest_drop", text: "Keep your chest up and your weight over the middle of your feet.", speech: "Chest up", when: [{ metric: "torso", op: ">=", value: 55 }], sustainMs: 300 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  libraryIds: ["bodyweight_squat", "free-exercise-db-Bodyweight_Squat"],
  names: ["squat", "squats", "air squat", "air squats", "bodyweight squat", "bodyweight squats", "body weight squat", "body weight squats"],
};

const splitSquat: ExerciseRule = {
  id: "split_squat",
  name: "Split squat / lunge",
  view: "side",
  checks: "Counts reps from the knee nearest the camera and checks that your torso stays tall.",
  setupTips: [
    "Stand the phone upright at hip height, about 2 to 3 metres away.",
    "Stand side-on in a split stance, one foot forward, staying in the same spot.",
    "Do all reps on one leg, then switch sides; the count runs across both.",
  ],
  limits: "Walking lunges leave the camera's view, so count those by hand. The camera can't tell which leg is in front.",
  required: ["shoulder", "hip", "knee", "ankle"],
  minVisibility: 0.6,
  metrics: {
    knee: { kind: "angle", joints: ["hip", "knee", "ankle"], side: "visible" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [{ metric: "torso", op: "<=", value: 30 }],
  postureHint: "Stand tall in a split stance, side-on to the camera.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "knee", op: ">=", value: 155 }], exit: [{ metric: "knee", op: "<=", value: 145 }] },
    target: { enter: [{ metric: "knee", op: "<=", value: 110 }], exit: [{ metric: "knee", op: ">=", value: 120 }] },
    progress: { metric: "knee", from: 165, to: 100 },
    partialFloor: 0.3,
    minRepMs: 700,
    maxRepMs: 20_000,
    startHint: "Stand tall in your split stance to start.",
    partialCue: { text: "Lower your back knee closer to the floor.", speech: "Lower" },
    lockoutCue: { text: "Rise all the way up between reps.", speech: "All the way up" },
  },
  cues: [
    { id: "torso_lean", text: "Keep your torso tall, stacked over your hips.", speech: "Stay tall", when: [{ metric: "torso", op: ">=", value: 35 }], sustainMs: 400 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  libraryIds: ["split_squat", "free-exercise-db-Split_Squats"],
  names: ["split squat", "split squats", "lunge", "lunges", "static lunge", "static lunges", "stationary lunge", "stationary lunges", "reverse lunge", "reverse lunges", "forward lunge", "forward lunges"],
};

const gluteBridge: ExerciseRule = {
  id: "glute_bridge",
  name: "Glute bridge",
  view: "side",
  checks: "Counts reps when your hips rise until knees, hips and shoulders line up, and flags an over-arched back.",
  setupTips: [
    "Turn your phone sideways and stand it on the floor, about 2 metres away.",
    "Lie on your back side-on to the camera, knees bent and feet flat.",
    "Start with your hips resting on the floor.",
  ],
  limits: "The camera judges your hip line from the side; it can't feel which muscles do the work.",
  required: ["shoulder", "hip", "knee"],
  minVisibility: 0.6,
  metrics: {
    // Signed: past 180 means the hips rose above the shoulder-knee line (an over-arched back).
    hip: { kind: "angle", joints: ["shoulder", "hip", "knee"], side: "visible", signed: true },
    torso: { kind: "tilt", from: "shoulder", to: "hip", reference: "horizontal", side: "visible" },
  },
  posture: [{ metric: "torso", op: "<=", value: 45 }],
  postureHint: "Lie on your back, side-on to the camera, knees bent and feet flat.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "hip", op: "<=", value: 145 }], exit: [{ metric: "hip", op: ">=", value: 150 }] },
    target: { enter: [{ metric: "hip", op: ">=", value: 165 }], exit: [{ metric: "hip", op: "<=", value: 160 }] },
    progress: { metric: "hip", from: 140, to: 172 },
    partialFloor: 0.3,
    minRepMs: 600,
    maxRepMs: 20_000,
    startHint: "Lower your hips to the floor to start.",
    partialCue: { text: "Drive your hips higher, until knees, hips and shoulders line up.", speech: "Hips higher" },
  },
  cues: [
    { id: "over_arch", text: "Ribs down. Lift with your glutes, not by arching your lower back.", speech: "Ribs down", when: [{ metric: "hip", op: ">=", value: 195 }], during: ["target"], sustainMs: 300 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  libraryIds: ["glute_bridge", "free-exercise-db-Butt_Lift_Bridge"],
  names: ["glute bridge", "glute bridges", "bridge", "bridges", "hip bridge", "hip bridges", "butt lift bridge"],
};

const plank: ExerciseRule = {
  id: "plank",
  name: "Plank",
  view: "side",
  checks: "Times your hold only while your body stays in one straight line, and tells you when your hips sag or rise.",
  setupTips: [
    "Turn your phone sideways and stand it on the floor, about 2 metres away.",
    "Get side-on to the camera on your forearms or hands, legs straight.",
    "The timer starts when your body forms a straight line.",
  ],
  limits: "The camera checks your body line from one side; it can't see whether your shoulders are level.",
  required: ["shoulder", "elbow", "hip", "knee", "ankle"],
  minVisibility: 0.6,
  metrics: {
    body: { kind: "tilt", from: "shoulder", to: "ankle", reference: "horizontal", side: "visible" },
    hips: { kind: "lineOffset", from: "shoulder", to: "ankle", point: "hip", side: "visible" },
    knee: { kind: "angle", joints: ["hip", "knee", "ankle"], side: "visible" },
    arm: { kind: "rise", lower: "elbow", upper: "shoulder", side: "visible" },
  },
  posture: [
    { metric: "body", op: "<=", value: 30 },
    { metric: "arm", op: ">=", value: 0.55 },
    { metric: "knee", op: ">=", value: 140 },
  ],
  postureHint: "Get into a forearm or high plank, side-on to the camera, legs straight.",
  motion: {
    kind: "hold",
    form: [
      { metric: "hips", op: "<=", value: 0.07 },
      { metric: "hips", op: ">=", value: -0.1 },
    ],
    formGraceMs: 300,
  },
  cues: [
    { id: "hip_sag", text: "Hips are sagging. Squeeze your glutes and brace your stomach.", speech: "Lift your hips", when: [{ metric: "hips", op: ">=", value: 0.07 }], sustainMs: 500 },
    { id: "hip_pike", text: "Hips are too high. Lower them into a straight line.", speech: "Hips down", when: [{ metric: "hips", op: "<=", value: -0.1 }], sustainMs: 500 },
  ],
  smoothing: { minCutoff: 0.8, beta: 0.02 },
  libraryIds: ["plank", "free-exercise-db-Plank"],
  names: ["plank", "planks", "front plank", "forearm plank", "elbow plank", "high plank"],
};

const jumpingJack: ExerciseRule = {
  id: "jumping_jack",
  name: "Jumping jack",
  view: "front",
  checks: "Counts a jack when both arms reach overhead and your feet land wide, then come back together.",
  setupTips: [
    "Stand the phone upright at chest height, about 3 metres away.",
    "Face the camera with your whole body in view, arms by your sides.",
    "Good light helps the camera follow fast arms.",
  ],
  limits: "Very fast jacks can blur on older phones; if counts lag, slow down slightly.",
  required: ["shoulder", "wrist", "hip", "ankle"],
  minVisibility: 0.5,
  metrics: {
    armLow: { kind: "angle", joints: ["hip", "shoulder", "wrist"], side: "both-min" },
    armHigh: { kind: "angle", joints: ["hip", "shoulder", "wrist"], side: "both-max" },
    legs: { kind: "spread", joint: "ankle", reference: "shoulder" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [{ metric: "torso", op: "<=", value: 25 }],
  postureHint: "Stand facing the camera with your whole body in view.",
  motion: {
    kind: "reps",
    start: {
      enter: [{ metric: "armHigh", op: "<=", value: 60 }, { metric: "legs", op: "<=", value: 1 }],
      exit: [{ metric: "armHigh", op: ">=", value: 75 }, { metric: "legs", op: ">=", value: 1.15 }],
    },
    target: {
      enter: [{ metric: "armLow", op: ">=", value: 135 }, { metric: "legs", op: ">=", value: 1.4 }],
      exit: [{ metric: "armLow", op: "<=", value: 120 }, { metric: "legs", op: "<=", value: 1.25 }],
    },
    progress: { metric: "armLow", from: 30, to: 150 },
    partialFloor: 0.3,
    minRepMs: 350,
    maxRepMs: 6_000,
    startHint: "Stand tall with your arms by your sides and feet together.",
    partialCue: { text: "Arms all the way overhead and feet wide on every jack.", speech: "All the way" },
  },
  cues: [
    { id: "arms_low", text: "Raise your arms all the way overhead.", speech: "Arms up", when: [{ metric: "legs", op: ">=", value: 1.4 }, { metric: "armLow", op: "<=", value: 130 }], during: ["outbound", "inbound"], sustainMs: 150 },
    { id: "feet_narrow", text: "Jump your feet wider.", speech: "Feet wider", when: [{ metric: "armLow", op: ">=", value: 135 }, { metric: "legs", op: "<=", value: 1.3 }], during: ["outbound", "inbound"], sustainMs: 150 },
  ],
  smoothing: { minCutoff: 2, beta: 0.05 },
  libraryIds: ["jumping_jack"],
  names: ["jumping jack", "jumping jacks", "star jump", "star jumps"],
};

/** The supported exercises, in the order the practice page lists them. */
export const EXERCISE_RULES: readonly ExerciseRule[] = [pushUp, bodyweightSquat, splitSquat, gluteBridge, plank, jumpingJack];

const BY_ID = new Map<string, ExerciseRule>(EXERCISE_RULES.map((rule) => [rule.id, rule]));

export function getExerciseRule(id: ExerciseId | string): ExerciseRule | null {
  return BY_ID.get(id) ?? null;
}

/** Lower case, letters and digits only, single spaces: "Push-Ups" and "push ups" both become "pushups"/"push ups". */
export function normaliseExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/push[\s-]*ups?\b/g, (match) => (match.endsWith("s") ? "pushups" : "pushup"))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The camera rule for a workout exercise, by its exercise_library id first and its name second.
 * Null when the camera can't count it, so a workout screen can offer "Count with camera" only
 * where it works.
 */
export function cameraRuleFor(exercise: { id?: string | null; name?: string | null }): ExerciseRule | null {
  if (exercise.id) {
    const byId = EXERCISE_RULES.find((rule) => rule.id === exercise.id || rule.libraryIds.includes(exercise.id as string));
    if (byId) return byId;
  }
  if (exercise.name) {
    const name = normaliseExerciseName(exercise.name);
    return EXERCISE_RULES.find((rule) => rule.names.includes(name) || normaliseExerciseName(rule.name) === name) ?? null;
  }
  return null;
}
