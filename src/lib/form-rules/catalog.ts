/**
 * The exercises the camera coach supports, as data. Angles are in degrees measured on the
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
  landscape: true,
  checks: "Counts reps from your elbow angle and watches that your hips stay in one line with your shoulders and ankles.",
  setupTips: [
    "With auto-rotate on (rotation lock off), turn your phone sideways and stand it on the floor, about 2 metres away.",
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
  limits: "From the side the camera can't see your knees moving inwards; a front view would be needed for that. Jogging or high knees on the spot can be miscounted as squats.",
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
  limits: "Walking lunges leave the camera's view, so count those by hand. The camera can't tell which leg is in front, and jogging on the spot can be miscounted as reps.",
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
  names: ["split squat", "split squats", "lunge", "lunges", "static lunge", "static lunges", "stationary lunge", "stationary lunges", "forward lunge", "forward lunges"],
};

const gluteBridge: ExerciseRule = {
  id: "glute_bridge",
  name: "Glute bridge",
  view: "side",
  landscape: true,
  checks: "Counts reps when your hips rise until knees, hips and shoulders line up, and flags an over-arched back.",
  setupTips: [
    "With auto-rotate on (rotation lock off), turn your phone sideways and stand it on the floor, about 2 metres away.",
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
  landscape: true,
  checks: "Times your hold only while your body stays in one straight line, and tells you when your hips sag or rise.",
  setupTips: [
    "With auto-rotate on (rotation lock off), turn your phone sideways and stand it on the floor, about 2 metres away.",
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
  headroom: 0.4,
  libraryIds: ["jumping_jack"],
  names: ["jumping jack", "jumping jacks", "star jump", "star jumps"],
};

const reverseLunge: ExerciseRule = {
  id: "reverse_lunge",
  name: "Reverse lunge",
  view: "side",
  checks: "Counts a rep each time you step back, lower to a bent knee and stand up again, and keeps your torso tall.",
  setupTips: [
    "Stand the phone upright at hip height, about 2 to 3 metres away.",
    "Stand side-on with your feet together and your whole body in view.",
    "Step back and return to standing every rep; switch legs whenever you like.",
  ],
  limits: "The camera reads the knee nearest it, so it can't see which leg stepped back or whether your front knee drifts inwards.",
  required: ["shoulder", "hip", "knee", "ankle"],
  minVisibility: 0.6,
  metrics: {
    knee: { kind: "angle", joints: ["hip", "knee", "ankle"], side: "visible" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [{ metric: "torso", op: "<=", value: 30 }],
  postureHint: "Stand tall with your feet together, side-on to the camera.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "knee", op: ">=", value: 160 }], exit: [{ metric: "knee", op: "<=", value: 150 }] },
    target: { enter: [{ metric: "knee", op: "<=", value: 110 }], exit: [{ metric: "knee", op: ">=", value: 120 }] },
    progress: { metric: "knee", from: 170, to: 100 },
    partialFloor: 0.3,
    minRepMs: 900,
    maxRepMs: 20_000,
    startHint: "Stand tall with your feet together to start.",
    partialCue: { text: "Step back far enough to lower your back knee towards the floor.", speech: "Lower" },
    lockoutCue: { text: "Bring your feet together and stand tall between reps.", speech: "Stand tall" },
  },
  cues: [
    { id: "torso_lean", text: "Keep your chest up, shoulders over your hips.", speech: "Chest up", when: [{ metric: "torso", op: ">=", value: 30 }], sustainMs: 400 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  // The library has only a dumbbell rear lunge: a bodyweight set from Home workout saves under its own name instead.
  // The name below still offers the camera on that exercise in a gym workout (the movement is the same).
  libraryIds: [],
  names: ["reverse lunge", "reverse lunges", "rear lunge", "rear lunges", "backward lunge", "backward lunges", "dumbbell rear lunge"],
};

const highKnees: ExerciseRule = {
  id: "high_knees",
  name: "High knees",
  view: "front",
  checks: "Counts every knee that rises to hip height and tells you when your knees stay low or you lean to one side.",
  setupTips: [
    "Stand the phone upright at chest height, about 3 metres away.",
    "Face the camera with your whole body in view.",
    "Run on the spot, driving each knee up to hip height.",
  ],
  limits: "Facing the camera, a lifted thigh points at the lens, so very fast or very low knees can be missed. Good light helps.",
  required: ["shoulder", "hip", "knee", "ankle"],
  minVisibility: 0.5,
  metrics: {
    // The higher knee, measured against each side's own torso length.
    kneeHigh: { kind: "level", point: "knee", base: "hip", scale: ["shoulder", "hip"], side: "both-max" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [{ metric: "torso", op: "<=", value: 25 }],
  postureHint: "Stand facing the camera with your whole body in view.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "kneeHigh", op: "<=", value: -0.6 }], exit: [{ metric: "kneeHigh", op: ">=", value: -0.5 }] },
    target: { enter: [{ metric: "kneeHigh", op: ">=", value: -0.35 }], exit: [{ metric: "kneeHigh", op: "<=", value: -0.45 }] },
    progress: { metric: "kneeHigh", from: -0.8, to: -0.3 },
    partialFloor: 0.3,
    minRepMs: 200,
    maxRepMs: 3_000,
    startHint: "Stand tall, then start running on the spot.",
    partialCue: { text: "Drive each knee up to hip height.", speech: "Knees higher" },
  },
  cues: [
    { id: "lean", text: "Stay upright; don't lean to one side to lift your knees.", speech: "Stay upright", when: [{ metric: "torso", op: ">=", value: 20 }], sustainMs: 200 },
  ],
  smoothing: { minCutoff: 2, beta: 0.05 },
  libraryIds: [],
  names: ["high knees", "high knee", "high knee run", "high knees run", "running high knees"],
};

const mountainClimber: ExerciseRule = {
  id: "mountain_climber",
  name: "Mountain climber",
  view: "side",
  landscape: true,
  checks: "Counts each drive of the knee nearest the camera towards your chest and watches that your hips stay level.",
  setupTips: [
    "With auto-rotate on (rotation lock off), turn your phone sideways and stand it on the floor, about 2 metres away.",
    "Get into a high plank, side-on to the camera, hands under your shoulders.",
    "Drive your knees in one at a time; the near knee is counted.",
  ],
  limits: "Only the leg nearest the camera is counted; the far leg is hidden behind your body. It can't see whether your shoulders stay over your hands from the front.",
  required: ["shoulder", "wrist", "hip", "knee"],
  minVisibility: 0.6,
  metrics: {
    hip: { kind: "angle", joints: ["shoulder", "hip", "knee"], side: "visible" },
    torso: { kind: "tilt", from: "shoulder", to: "hip", reference: "horizontal", side: "visible" },
    arm: { kind: "rise", lower: "wrist", upper: "shoulder", side: "visible" },
    // Hip height against the shoulder, in torso lengths: about -0.3 to -0.45 in a good plank.
    hipLevel: { kind: "level", point: "hip", base: "shoulder", scale: ["shoulder", "hip"], side: "visible" },
  },
  posture: [
    { metric: "torso", op: "<=", value: 45 },
    { metric: "arm", op: ">=", value: 0.6 },
  ],
  postureHint: "Get into a high plank, side-on to the camera, arms straight.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "hip", op: ">=", value: 150 }], exit: [{ metric: "hip", op: "<=", value: 140 }] },
    target: { enter: [{ metric: "hip", op: "<=", value: 105 }], exit: [{ metric: "hip", op: ">=", value: 115 }] },
    progress: { metric: "hip", from: 165, to: 90 },
    partialFloor: 0.3,
    minRepMs: 250,
    maxRepMs: 4_000,
    startHint: "Hold a high plank, then drive a knee in.",
    partialCue: { text: "Bring your knee all the way in under your chest.", speech: "Knee further in" },
  },
  cues: [
    { id: "hip_pike", text: "Hips are too high. Lower them level with your shoulders.", speech: "Hips down", when: [{ metric: "hipLevel", op: ">=", value: 0.05 }], sustainMs: 250 },
    { id: "hip_sag", text: "Hips are sagging. Brace your stomach and lift them.", speech: "Lift your hips", when: [{ metric: "hipLevel", op: "<=", value: -0.62 }], sustainMs: 250 },
  ],
  smoothing: { minCutoff: 2, beta: 0.05 },
  libraryIds: ["free-exercise-db-Mountain_Climbers"],
  names: ["mountain climber", "mountain climbers"],
};

const sidePlank: ExerciseRule = {
  id: "side_plank",
  name: "Side plank",
  view: "front",
  landscape: true,
  checks: "Times your hold while your body stays in one straight line from shoulders to ankles, and says when your hips drop.",
  setupTips: [
    "With auto-rotate on (rotation lock off), turn your phone sideways and stand it on the floor, about 2 metres away.",
    "Lie on your side facing the camera, elbow under your shoulder, feet stacked.",
    "Lift your hips; the timer runs while your body is straight.",
  ],
  limits: "The camera sees your body line from the front; it can't tell whether your hips roll forwards or back.",
  required: ["shoulder", "elbow", "hip", "ankle"],
  minVisibility: 0.5,
  metrics: {
    body: { kind: "tilt", from: "shoulder", to: "ankle", reference: "horizontal", side: "visible" },
    hips: { kind: "lineOffset", from: "shoulder", to: "ankle", point: "hip", side: "visible" },
    // The supporting arm: its elbow sits under its shoulder.
    arm: { kind: "rise", lower: "elbow", upper: "shoulder", side: "both-max" },
  },
  posture: [
    { metric: "body", op: "<=", value: 45 },
    { metric: "arm", op: ">=", value: 0.6 },
  ],
  postureHint: "Lie on your side facing the camera, elbow under your shoulder, and lift your hips.",
  motion: {
    kind: "hold",
    form: [
      { metric: "hips", op: "<=", value: 0.07 },
      { metric: "hips", op: ">=", value: -0.1 },
    ],
    formGraceMs: 300,
  },
  cues: [
    { id: "hip_drop", text: "Hips are dropping. Push the floor away and lift them into line.", speech: "Hips up", when: [{ metric: "hips", op: ">=", value: 0.07 }], sustainMs: 500 },
    { id: "hip_pike", text: "Hips are too high. Lower them into a straight line.", speech: "Hips down", when: [{ metric: "hips", op: "<=", value: -0.1 }], sustainMs: 500 },
  ],
  smoothing: { minCutoff: 0.8, beta: 0.02 },
  libraryIds: [],
  names: ["side plank", "side planks", "forearm side plank", "side bridge"],
};

const wallSit: ExerciseRule = {
  id: "wall_sit",
  name: "Wall sit",
  view: "side",
  checks: "Times your hold while your knees stay near a right angle and your back stays against the wall.",
  setupTips: [
    "Stand the phone upright at hip height, about 2 metres away.",
    "Stand side-on with your back against a wall, feet a step out from it.",
    "Slide down until your thighs are level with the floor.",
  ],
  limits: "The camera can't see the wall itself, only your body line, so it trusts that your back is resting on it.",
  required: ["shoulder", "hip", "knee", "ankle"],
  minVisibility: 0.6,
  metrics: {
    knee: { kind: "angle", joints: ["hip", "knee", "ankle"], side: "visible" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [
    { metric: "knee", op: "<=", value: 135 },
    { metric: "torso", op: "<=", value: 35 },
  ],
  postureHint: "Slide down the wall until your thighs are close to level.",
  motion: {
    kind: "hold",
    form: [
      { metric: "knee", op: "<=", value: 110 },
      { metric: "knee", op: ">=", value: 70 },
      { metric: "torso", op: "<=", value: 25 },
    ],
    formGraceMs: 400,
  },
  cues: [
    { id: "too_high", text: "Slide a little lower, thighs level with the floor.", speech: "Slide lower", when: [{ metric: "knee", op: ">=", value: 112 }], sustainMs: 500 },
    { id: "too_low", text: "Too low. Walk your feet out so your knees sit over your ankles.", speech: "Feet out", when: [{ metric: "knee", op: "<=", value: 68 }], sustainMs: 500 },
    { id: "lean", text: "Press your back flat against the wall.", speech: "Back to the wall", when: [{ metric: "torso", op: ">=", value: 27 }], sustainMs: 500 },
  ],
  smoothing: { minCutoff: 0.8, beta: 0.02 },
  libraryIds: [],
  names: ["wall sit", "wall sits", "wall squat", "wall squats"],
};

const superman: ExerciseRule = {
  id: "superman",
  name: "Superman",
  view: "side",
  landscape: true,
  checks: "Counts a rep when your chest and legs lift off the floor together, and says when only one end lifts.",
  setupTips: [
    "With auto-rotate on (rotation lock off), turn your phone sideways and stand it on the floor, about 2 metres away.",
    "Lie face down side-on to the camera, arms reaching forward.",
    "Lift your chest, arms and legs together, pause, then lower.",
  ],
  limits: "A low camera sees small lifts best; it can't tell how high your arms are or whether your neck stays long.",
  required: ["shoulder", "hip", "knee", "ankle"],
  minVisibility: 0.6,
  metrics: {
    // Hips sit below the shoulder-ankle line once both ends lift (+ = a deeper curve).
    arch: { kind: "lineOffset", from: "shoulder", to: "ankle", point: "hip", side: "visible" },
    body: { kind: "tilt", from: "shoulder", to: "ankle", reference: "horizontal", side: "visible" },
    chest: { kind: "tilt", from: "hip", to: "shoulder", reference: "horizontal", side: "visible" },
    legs: { kind: "tilt", from: "hip", to: "ankle", reference: "horizontal", side: "visible" },
  },
  posture: [{ metric: "body", op: "<=", value: 25 }],
  postureHint: "Lie face down, side-on to the camera, arms reaching forward.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "arch", op: "<=", value: 0.025 }], exit: [{ metric: "arch", op: ">=", value: 0.035 }] },
    target: { enter: [{ metric: "arch", op: ">=", value: 0.06 }], exit: [{ metric: "arch", op: "<=", value: 0.045 }] },
    progress: { metric: "arch", from: 0.01, to: 0.08 },
    partialFloor: 0.3,
    minRepMs: 800,
    maxRepMs: 15_000,
    startHint: "Lie flat to start.",
    partialCue: { text: "Lift your chest and legs a little higher.", speech: "Lift higher" },
    lockoutCue: { text: "Lower all the way to the floor between reps.", speech: "All the way down" },
  },
  cues: [
    { id: "legs_down", text: "Lift your legs as well as your chest.", speech: "Legs up", when: [{ metric: "legs", op: "<=", value: 3 }, { metric: "chest", op: ">=", value: 12 }], during: ["outbound", "target"], sustainMs: 300 },
    { id: "chest_down", text: "Lift your chest as well as your legs.", speech: "Chest up", when: [{ metric: "chest", op: "<=", value: 3 }, { metric: "legs", op: ">=", value: 8 }], during: ["outbound", "target"], sustainMs: 300 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  libraryIds: [],
  names: ["superman", "supermans", "superman hold", "prone back extension"],
};

const shoulderPress: ExerciseRule = {
  id: "shoulder_press",
  name: "Shoulder press",
  view: "front",
  checks: "Counts a rep when both arms press from your shoulders to straight overhead, and says when you lean back.",
  setupTips: [
    "Stand the phone upright at chest height, about 2 to 3 metres away.",
    "Face the camera holding light dumbbells, or full water bottles, at your shoulders.",
    "Press both arms straight up, then lower to your shoulders.",
  ],
  limits: "Facing the camera it can't see whether the weights drift forwards, and it can't see how heavy they are.",
  required: ["shoulder", "elbow", "wrist", "hip"],
  minVisibility: 0.5,
  metrics: {
    elbowMin: { kind: "angle", joints: ["shoulder", "elbow", "wrist"], side: "both-min" },
    elbowMax: { kind: "angle", joints: ["shoulder", "elbow", "wrist"], side: "both-max" },
    // The lower hand's height above its shoulder, in torso lengths.
    wristLow: { kind: "level", point: "wrist", base: "shoulder", scale: ["shoulder", "hip"], side: "both-min" },
    // Leaning back is a move towards or away from the lens: only the 3D landmarks see it from the front.
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible", space: "world" },
  },
  posture: [
    { metric: "torso", op: "<=", value: 20 },
    { metric: "wristLow", op: ">=", value: -0.3 },
  ],
  postureHint: "Face the camera and bring the weights up to your shoulders.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "elbowMax", op: "<=", value: 100 }], exit: [{ metric: "elbowMax", op: ">=", value: 110 }] },
    target: {
      enter: [{ metric: "elbowMax", op: ">=", value: 155 }, { metric: "elbowMin", op: ">=", value: 155 }, { metric: "wristLow", op: ">=", value: 0.75 }],
      exit: [{ metric: "elbowMax", op: "<=", value: 145 }, { metric: "elbowMin", op: "<=", value: 145 }, { metric: "wristLow", op: "<=", value: 0.65 }],
    },
    progress: { metric: "elbowMin", from: 90, to: 165 },
    partialFloor: 0.3,
    minRepMs: 700,
    maxRepMs: 15_000,
    startHint: "Hold the weights at your shoulders to start.",
    partialCue: { text: "Press until both arms are straight overhead.", speech: "All the way up" },
    lockoutCue: { text: "Lower the weights to your shoulders each rep.", speech: "Lower to shoulders" },
  },
  cues: [
    { id: "lean_back", text: "Ribs down. Press without leaning back.", speech: "Ribs down", when: [{ metric: "torso", op: ">=", value: 15 }], sustainMs: 400 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  headroom: 0.42,
  libraryIds: ["dumbbell_shoulder_press", "free-exercise-db-Dumbbell_Shoulder_Press"],
  names: ["shoulder press", "shoulder presses", "dumbbell shoulder press", "overhead press", "dumbbell overhead press", "standing dumbbell press"],
};

const bicepsCurl: ExerciseRule = {
  id: "biceps_curl",
  name: "Biceps curl",
  view: "side",
  checks: "Counts reps from your elbow angle and says when your elbows drift forwards or your body swings.",
  setupTips: [
    "Stand the phone upright at chest height, about 2 metres away.",
    "Stand side-on holding light dumbbells, or full water bottles, arms by your sides.",
    "Curl up without moving your elbows, then lower all the way.",
  ],
  limits: "The camera follows the arm nearest it; it can't see your far arm or your grip.",
  required: ["shoulder", "elbow", "wrist", "hip"],
  minVisibility: 0.6,
  metrics: {
    elbow: { kind: "angle", joints: ["shoulder", "elbow", "wrist"], side: "visible" },
    upperArm: { kind: "tilt", from: "shoulder", to: "elbow", reference: "vertical", side: "visible" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [
    { metric: "torso", op: "<=", value: 20 },
    { metric: "upperArm", op: "<=", value: 35 },
  ],
  postureHint: "Stand tall, side-on to the camera, arms by your sides.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "elbow", op: ">=", value: 150 }], exit: [{ metric: "elbow", op: "<=", value: 140 }] },
    target: { enter: [{ metric: "elbow", op: "<=", value: 65 }], exit: [{ metric: "elbow", op: ">=", value: 75 }] },
    progress: { metric: "elbow", from: 160, to: 55 },
    partialFloor: 0.3,
    minRepMs: 700,
    maxRepMs: 15_000,
    startHint: "Let your arms hang straight to start.",
    partialCue: { text: "Curl the weight all the way up to your shoulder.", speech: "All the way up" },
    lockoutCue: { text: "Lower until your arm is straight each rep.", speech: "Straighten your arm" },
  },
  cues: [
    { id: "elbow_drift", text: "Keep your elbows pinned at your sides.", speech: "Elbows in", when: [{ metric: "upperArm", op: ">=", value: 30 }], sustainMs: 300 },
    { id: "swing", text: "Stand still; don't swing your body to lift.", speech: "No swinging", when: [{ metric: "torso", op: ">=", value: 12 }], sustainMs: 300 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  libraryIds: ["biceps_curl", "free-exercise-db-Dumbbell_Bicep_Curl"],
  names: ["biceps curl", "biceps curls", "bicep curl", "bicep curls", "dumbbell curl", "dumbbell curls", "dumbbell bicep curl", "dumbbell biceps curl"],
};

const lateralRaise: ExerciseRule = {
  id: "lateral_raise",
  name: "Lateral raise",
  view: "front",
  checks: "Counts a rep when both arms lift out to the sides to shoulder height and lower again, and says when you swing or lift too high.",
  setupTips: [
    "Stand the phone upright at chest height, about 2 to 3 metres away.",
    "Face the camera holding light dumbbells, or full water bottles, by your sides.",
    "Lift both arms out to shoulder height with a soft bend in the elbows, then lower slowly.",
  ],
  limits: "Facing the camera it can't see whether your hands drift forwards or which way the weights tilt, and it can't tell how heavy they are.",
  required: ["shoulder", "elbow", "wrist", "hip"],
  minVisibility: 0.5,
  metrics: {
    // Arm away from the side of the body: about 15° hanging, 90° at shoulder height.
    armLow: { kind: "angle", joints: ["hip", "shoulder", "wrist"], side: "both-min" },
    armHigh: { kind: "angle", joints: ["hip", "shoulder", "wrist"], side: "both-max" },
    elbow: { kind: "angle", joints: ["shoulder", "elbow", "wrist"], side: "both-min" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible", space: "world" },
  },
  posture: [{ metric: "torso", op: "<=", value: 20 }],
  postureHint: "Stand tall facing the camera, weights by your sides.",
  motion: {
    kind: "reps",
    start: {
      enter: [{ metric: "armLow", op: "<=", value: 35 }, { metric: "armHigh", op: "<=", value: 35 }],
      exit: [{ metric: "armLow", op: ">=", value: 45 }, { metric: "armHigh", op: ">=", value: 45 }],
    },
    target: { enter: [{ metric: "armLow", op: ">=", value: 75 }], exit: [{ metric: "armLow", op: "<=", value: 65 }] },
    progress: { metric: "armLow", from: 20, to: 85 },
    partialFloor: 0.3,
    minRepMs: 800,
    maxRepMs: 15_000,
    startHint: "Let the weights hang by your sides to start.",
    partialCue: { text: "Lift both arms all the way to shoulder height.", speech: "Up to shoulders" },
    lockoutCue: { text: "Lower the weights to your sides between reps.", speech: "All the way down" },
  },
  cues: [
    { id: "too_high", text: "Stop at shoulder height; going higher shrugs the weight onto your neck.", speech: "Shoulder height", when: [{ metric: "armHigh", op: ">=", value: 115 }], during: ["target"], sustainMs: 250 },
    { id: "swing", text: "Stand still; lift without swinging your body.", speech: "No swinging", when: [{ metric: "torso", op: ">=", value: 12 }], sustainMs: 300 },
    { id: "bent_arms", text: "Keep a soft bend in your elbows, not a curl.", speech: "Longer arms", when: [{ metric: "elbow", op: "<=", value: 120 }], during: ["outbound", "target"], sustainMs: 300 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  headroom: 0.2,
  libraryIds: ["lateral_raise", "band_lateral_raise", "free-exercise-db-Side_Lateral_Raise"],
  names: ["lateral raise", "lateral raises", "dumbbell lateral raise", "dumbbell lateral raises", "side lateral raise", "side lateral raises", "side raise", "side raises", "band lateral raise"],
};

const frontRaise: ExerciseRule = {
  id: "front_raise",
  name: "Front raise",
  view: "side",
  checks: "Counts a rep when your arm lifts straight in front of you to shoulder height and lowers again, and says when you swing.",
  setupTips: [
    "Stand the phone upright at chest height, about 2 metres away.",
    "Stand side-on holding light dumbbells, or full water bottles, in front of your thighs.",
    "Lift to shoulder height with straight arms, then lower slowly.",
  ],
  limits: "The camera follows the arm nearest it; it can't see your far arm or whether your hands stay level with each other.",
  required: ["shoulder", "elbow", "wrist", "hip"],
  minVisibility: 0.6,
  metrics: {
    arm: { kind: "angle", joints: ["hip", "shoulder", "wrist"], side: "visible" },
    elbow: { kind: "angle", joints: ["shoulder", "elbow", "wrist"], side: "visible" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [{ metric: "torso", op: "<=", value: 20 }],
  postureHint: "Stand tall, side-on to the camera, weights in front of your thighs.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "arm", op: "<=", value: 35 }], exit: [{ metric: "arm", op: ">=", value: 45 }] },
    target: { enter: [{ metric: "arm", op: ">=", value: 80 }], exit: [{ metric: "arm", op: "<=", value: 70 }] },
    progress: { metric: "arm", from: 20, to: 90 },
    partialFloor: 0.3,
    minRepMs: 800,
    maxRepMs: 15_000,
    startHint: "Let the weights rest in front of your thighs to start.",
    partialCue: { text: "Lift until your arm is level with your shoulder.", speech: "Up to shoulders" },
    lockoutCue: { text: "Lower all the way to your thighs between reps.", speech: "All the way down" },
  },
  cues: [
    { id: "too_high", text: "Stop at shoulder height.", speech: "Shoulder height", when: [{ metric: "arm", op: ">=", value: 125 }], during: ["target"], sustainMs: 250 },
    { id: "swing", text: "Stand still; lift without leaning back or swinging.", speech: "No swinging", when: [{ metric: "torso", op: ">=", value: 12 }], sustainMs: 300 },
    { id: "bent_arm", text: "Keep your arm long, with only a soft bend at the elbow.", speech: "Longer arm", when: [{ metric: "elbow", op: "<=", value: 130 }], during: ["outbound", "target"], sustainMs: 300 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  libraryIds: ["free-exercise-db-Front_Dumbbell_Raise"],
  names: ["front raise", "front raises", "front dumbbell raise", "front dumbbell raises", "dumbbell front raise", "dumbbell front raises"],
};

const tricepsExtension: ExerciseRule = {
  id: "triceps_extension",
  name: "Overhead triceps extension",
  view: "side",
  checks: "Counts a rep when the weight lowers behind your head and presses back to straight arms, and says when your elbows drift or your back arches.",
  setupTips: [
    "Stand the phone upright at chest height, about 2 to 3 metres away, with room above your head in the picture.",
    "Stand side-on holding one dumbbell overhead in both hands, arms straight.",
    "Lower it behind your head by bending only at the elbows, then straighten.",
  ],
  limits: "Side-on the camera can't see whether your elbows flare outwards, and it follows the arm nearest it.",
  required: ["shoulder", "elbow", "wrist", "hip"],
  minVisibility: 0.6,
  metrics: {
    elbow: { kind: "angle", joints: ["shoulder", "elbow", "wrist"], side: "visible" },
    // The upper arm points up: elbow above the shoulder, close to vertical.
    upperArm: { kind: "tilt", from: "shoulder", to: "elbow", reference: "vertical", side: "visible" },
    elbowUp: { kind: "rise", lower: "shoulder", upper: "elbow", side: "visible" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [
    { metric: "torso", op: "<=", value: 20 },
    { metric: "elbowUp", op: ">=", value: 0.6 },
  ],
  postureHint: "Stand side-on and hold the weight straight overhead.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "elbow", op: ">=", value: 150 }], exit: [{ metric: "elbow", op: "<=", value: 140 }] },
    target: { enter: [{ metric: "elbow", op: "<=", value: 85 }], exit: [{ metric: "elbow", op: ">=", value: 95 }] },
    progress: { metric: "elbow", from: 165, to: 75 },
    partialFloor: 0.3,
    minRepMs: 800,
    maxRepMs: 15_000,
    startHint: "Straighten your arms overhead to start.",
    partialCue: { text: "Lower the weight further behind your head.", speech: "Lower" },
    lockoutCue: { text: "Straighten your arms fully at the top.", speech: "Arms straight" },
  },
  cues: [
    { id: "elbow_drift", text: "Keep your upper arms still, elbows pointing up.", speech: "Elbows up", when: [{ metric: "upperArm", op: ">=", value: 35 }], during: ["outbound", "target", "inbound"], sustainMs: 300 },
    { id: "arch", text: "Ribs down; don't arch your back to lift.", speech: "Ribs down", when: [{ metric: "torso", op: ">=", value: 14 }], sustainMs: 300 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  headroom: 0.45,
  libraryIds: ["triceps_extension", "free-exercise-db-Standing_Dumbbell_Triceps_Extension"],
  names: ["overhead triceps extension", "overhead tricep extension", "dumbbell overhead triceps extension", "triceps extension", "tricep extension", "standing dumbbell triceps extension"],
};

const romanianDeadlift: ExerciseRule = {
  id: "romanian_deadlift",
  name: "Romanian deadlift",
  view: "side",
  checks: "Counts a rep when you hinge your hips back until your torso leans well forward and stand tall again, and says when you squat instead of hinge.",
  setupTips: [
    "Stand the phone upright at hip height, about 2 to 3 metres away.",
    "Stand side-on holding dumbbells or a bar in front of your thighs.",
    "Push your hips back with soft knees, lower the weight along your legs, then stand tall.",
  ],
  limits: "One camera can't see whether your back stays flat or rounds; keep your spine long. It can't tell how heavy the weight is.",
  required: ["shoulder", "hip", "knee", "ankle"],
  minVisibility: 0.6,
  metrics: {
    hip: { kind: "angle", joints: ["shoulder", "hip", "knee"], side: "visible" },
    knee: { kind: "angle", joints: ["hip", "knee", "ankle"], side: "visible" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [{ metric: "torso", op: "<=", value: 25 }],
  postureHint: "Stand tall, side-on to the camera, weight in front of your thighs.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "hip", op: ">=", value: 160 }], exit: [{ metric: "hip", op: "<=", value: 150 }] },
    target: { enter: [{ metric: "hip", op: "<=", value: 115 }], exit: [{ metric: "hip", op: ">=", value: 125 }] },
    progress: { metric: "hip", from: 170, to: 105 },
    partialFloor: 0.3,
    minRepMs: 900,
    maxRepMs: 20_000,
    startHint: "Stand tall to start.",
    partialCue: { text: "Push your hips further back, until your torso leans well forward.", speech: "Hips back" },
    lockoutCue: { text: "Stand all the way up between reps.", speech: "Stand tall" },
  },
  cues: [
    { id: "squatting", text: "Keep only a soft bend in your knees; push your hips back rather than squatting down.", speech: "Hips back", when: [{ metric: "knee", op: "<=", value: 125 }], during: ["outbound", "target"], sustainMs: 300 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  libraryIds: ["romanian_deadlift", "dumbbell_rdl", "free-exercise-db-Stiff-Legged_Dumbbell_Deadlift"],
  names: ["romanian deadlift", "romanian deadlifts", "dumbbell romanian deadlift", "dumbbell romanian deadlifts", "rdl", "dumbbell rdl", "stiff legged dumbbell deadlift"],
};

const bentOverRow: ExerciseRule = {
  id: "bent_over_row",
  name: "Bent-over row",
  view: "side",
  checks: "Counts a rep when you pull the weight up to your body and lower it to straight arms, and says when you stand up to lift.",
  setupTips: [
    "Stand the phone upright at hip height, about 2 to 3 metres away.",
    "Stand side-on, hinge forward from your hips with a flat back, weights hanging under your shoulders.",
    "Pull your elbows back past your body, then lower until your arms are straight.",
  ],
  limits: "The camera follows the arm nearest it; it can't see your back rounding or how far your shoulder blades squeeze.",
  required: ["shoulder", "elbow", "wrist", "hip"],
  minVisibility: 0.6,
  metrics: {
    elbow: { kind: "angle", joints: ["shoulder", "elbow", "wrist"], side: "visible" },
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "vertical", side: "visible" },
  },
  posture: [
    { metric: "torso", op: ">=", value: 30 },
    { metric: "torso", op: "<=", value: 85 },
  ],
  postureHint: "Hinge forward from your hips, side-on to the camera, weights hanging under your shoulders.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "elbow", op: ">=", value: 150 }], exit: [{ metric: "elbow", op: "<=", value: 140 }] },
    target: { enter: [{ metric: "elbow", op: "<=", value: 95 }], exit: [{ metric: "elbow", op: ">=", value: 105 }] },
    progress: { metric: "elbow", from: 165, to: 85 },
    partialFloor: 0.3,
    minRepMs: 700,
    maxRepMs: 15_000,
    startHint: "Let the weights hang with straight arms to start.",
    partialCue: { text: "Pull your elbows further back, past your body.", speech: "Pull higher" },
    lockoutCue: { text: "Lower until your arms are straight each rep.", speech: "Arms straight" },
  },
  cues: [
    { id: "standing_up", text: "Stay hinged forward; don't stand up to lift the weight.", speech: "Stay low", when: [{ metric: "torso", op: "<=", value: 25 }], during: ["outbound", "target"], sustainMs: 300 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  libraryIds: ["free-exercise-db-Bent_Over_Two-Dumbbell_Row"],
  names: ["bent over row", "bent over rows", "bent over dumbbell row", "bent over dumbbell rows", "bent over two dumbbell row", "dumbbell bent over row"],
};

const sitUp: ExerciseRule = {
  id: "sit_up",
  name: "Sit-up",
  view: "side",
  landscape: true,
  checks: "Counts a rep when you curl all the way up from lying and lower back down, and says when your legs straighten.",
  setupTips: [
    "With auto-rotate on (rotation lock off), turn your phone sideways and stand it on the floor, about 2 metres away.",
    "Lie on your back side-on to the camera, knees bent and feet flat.",
    "Sit all the way up, then lower until your shoulders touch the floor.",
  ],
  limits: "The camera can't tell whether you pull on your neck or how your lower back moves; keep your hands light.",
  required: ["shoulder", "hip", "knee", "ankle"],
  minVisibility: 0.55,
  metrics: {
    // 0° lying flat, about 70° sitting up.
    torso: { kind: "tilt", from: "hip", to: "shoulder", reference: "horizontal", side: "visible" },
    knee: { kind: "angle", joints: ["hip", "knee", "ankle"], side: "visible" },
  },
  posture: [{ metric: "knee", op: "<=", value: 135 }],
  postureHint: "Lie on your back, side-on to the camera, knees bent and feet flat.",
  motion: {
    kind: "reps",
    start: { enter: [{ metric: "torso", op: "<=", value: 20 }], exit: [{ metric: "torso", op: ">=", value: 28 }] },
    target: { enter: [{ metric: "torso", op: ">=", value: 60 }], exit: [{ metric: "torso", op: "<=", value: 52 }] },
    progress: { metric: "torso", from: 5, to: 70 },
    partialFloor: 0.3,
    minRepMs: 900,
    maxRepMs: 15_000,
    startHint: "Lie back with your shoulders on the floor to start.",
    partialCue: { text: "Curl all the way up until you're sitting tall.", speech: "All the way up" },
    lockoutCue: { text: "Lower until your shoulders touch the floor.", speech: "All the way down" },
  },
  cues: [
    { id: "legs_straight", text: "Keep your knees bent and feet flat on the floor.", speech: "Knees bent", when: [{ metric: "knee", op: ">=", value: 150 }], sustainMs: 300 },
  ],
  smoothing: { minCutoff: 1, beta: 0.03 },
  libraryIds: ["free-exercise-db-Sit-Up"],
  names: ["sit up", "sit ups", "situp", "situps"],
};

/** The supported exercises, in the order the practice page lists them. */
export const EXERCISE_RULES: readonly ExerciseRule[] = [
  pushUp, bodyweightSquat, splitSquat, gluteBridge, plank, jumpingJack,
  reverseLunge, highKnees, mountainClimber, sidePlank, wallSit, superman, shoulderPress, bicepsCurl,
  lateralRaise, frontRaise, tricepsExtension, romanianDeadlift, bentOverRow, sitUp,
];

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

/**
 * Whether the camera's result fits the set it would fill: a rep count for a set logged in reps, a
 * hold time for a set logged in seconds. A timed prescription (such as 30 s of mountain climbers)
 * can't use a rep count, so a workout screen offers the camera only where this is true.
 */
export function cameraFitsSet(rule: Pick<ExerciseRule, "motion">, timedSet: boolean): boolean {
  return rule.motion.kind === (timedSet ? "hold" : "reps");
}
