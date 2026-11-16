// Pure derivation rules for the exercise catalogue. Each function takes a source row
// ({ name, description, instructions, equipment, movement_pattern, primary_muscle, difficulty }) and
// returns a value plus a short `why`, so the build can explain every decision. Rows the rules get wrong
// are corrected in curation.mjs, never with special cases here.

const lower = (value) => String(value ?? "").toLowerCase();

/** Name, description and instructions as one lower-case string (sentence breaks between parts). */
export function textOf(row) {
  return lower([row.name, row.description, ...(row.instructions ?? [])].join(". "));
}

// ---------------------------------------------------------------- equipment

/** Older equipment tags as keys. "other" is resolved from the name and instructions; unknown stays specialty. */
export const LEGACY_TAG_KEYS = Object.freeze({
  barbell: ["barbell"], dumbbell: ["dumbbell"], kettlebell: ["kettlebell"], ez_bar: ["ez_bar"], bands: ["resistance_band"],
  cable: ["cable_machine"], machine: ["machine"], medicine_ball: ["medicine_ball"], exercise_ball: ["stability_ball"],
  foam_roller: ["foam_roller"], bench: ["bench"], pull_up_bar: ["pull_up_bar"], rack: ["squat_rack"], bodyweight: [],
  other: ["specialty"],
});

const CARDIO_MACHINE = /treadmill|stationary|elliptical|stairmaster|step mill|recumbent/;
/** "a box or bench" and the like: a box satisfies it, and a bench covers a box (EQUIPMENT_COVERS). */
const BOX_OR_BENCH = /\b(box|bench|step|platform)(es|s)? or (a |an |other )?(sturdy |stable |low )?(box|bench|step|platform|elevated platform)(es|s)?\b/;
const PLATFORM_NAME = /\bbox(es)?\b|\bstep[- ]?ups?\b|depth jump|bench jump|bench sprint|quick leap|stride jump|push-off|drop push|incline push-up|decline push-up|feet elevated|elevated quad/;
const RACK_WORDS = /squat rack|power rack|squat stands?|\b(in|on|onto|from|off|into) (a|the) rack\b|\bunrack|j-hooks|\bpins\b|set the bar on a rack/;
/** The bar starts across the back, which in practice means taking it from a rack. */
const BAR_ON_BACK = /(barbell|bar) (placed |resting |racked )?(on|across) (the back of )?(your|the) (upper back|shoulders|traps)|on the back of your shoulders|on top of the traps|across your upper back|across the back of your shoulders|on your upper back/;
const EXPLICIT_RACK = /squat rack|power rack|squat stands?|\bpins\b|j-hooks/;
/** Mentions of a bench that are comparisons, not set-up ("like a bench press", "a standard bench grip"). */
const BENCH_COMPARISONS = /bench press(es|ing)?|bench grip|bench in reverse/g;
const STRONGMAN_IMPLEMENT = /atlas stone|\byoke\b|\blog\b|\btire\b|\bkeg\b|rickshaw|conan|circus bell|car deadlift|\baxle\b|sandbag|power stairs|sledgehammer/;

/**
 * Equipment keys from the legacy tags, the name and the instructions, before curation. Returns the keys
 * (unsorted; vocabulary.normalizeEquipment orders them and drops items a bench covers) and the reasons.
 */
export function ruleEquipment(row) {
  const name = lower(row.name);
  const text = textOf(row);
  const tags = row.equipment.length ? row.equipment : ["bodyweight"];
  // "other" is resolved below and only falls back to specialty when nothing more specific is named.
  const keys = new Set(tags.flatMap((tag) => {
    if (!LEGACY_TAG_KEYS[tag]) throw new Error(`Unknown legacy equipment tag "${tag}" on ${row.id}`);
    return tag === "other" ? [] : LEGACY_TAG_KEYS[tag];
  }));
  const why = [`tags ${tags.join("+")}`];
  const add = (key, reason) => { if (!keys.has(key)) { keys.add(key); why.push(`+${key} (${reason})`); } };
  const swap = (from, to, reason) => { if (keys.delete(from)) { keys.add(to); why.push(`${from}->${to} (${reason})`); } };

  if (CARDIO_MACHINE.test(name)) swap("machine", "cardio_machine", "a cardio machine");
  if (/\bsmith\b/.test(name)) {
    swap("machine", "smith_machine", "a Smith machine");
    swap("barbell", "smith_machine", "a Smith machine");
  }
  if (/\bez[- ]?bar\b/.test(name)) swap("barbell", "ez_bar", "an EZ bar named in the title");
  if (/\bchains?\b/.test(name)) add("specialty", "lifting chains");

  const freeOnly = tags.every((tag) => tag === "bodyweight" || tag === "other");
  if (!freeOnly) {
    // Free weights, cables and bands: a box, bench or rack from the set-up.
    const benchText = text.replace(BENCH_COMPARISONS, "");
    if (/\bbands?\b/.test(name)) add("resistance_band", "bands named in the title");
    if (PLATFORM_NAME.test(name) || BOX_OR_BENCH.test(text) || /\bbox\b/.test(text)) add("box", "a box or step");
    else if (keys.has("machine")) why.push("no bench: a weight machine has its own seat or pad");
    else if (/preacher/.test(name) || /\bbench\b/.test(name) || /\bbench\b/.test(benchText)) add("bench", "lies, sits or braces on a bench");
    if (keys.has("barbell") || keys.has("ez_bar")) {
      // A bench press's uprights are part of the bench; only an explicit power rack, pins or j-hooks add a rack.
      const lyingPress = keys.has("bench") && (/\b(lie|lying|lay|laying)\b/.test(benchText) || /bench press|skull ?crusher|triceps extension|pullover/.test(name));
      if (RACK_WORDS.test(text) && (!lyingPress || EXPLICIT_RACK.test(text))) add("squat_rack", "starts from a squat or power rack");
      else if (keys.has("barbell") && BAR_ON_BACK.test(text)) add("squat_rack", "the bar starts across the back, taken from a rack");
    }
    return { keys: [...keys], why };
  }

  // Bodyweight, untagged and "other" rows: the apparatus they name.
  if (/(pull-?up|pullup|chin-?up|chinup|chin up) (bar|apparatus|station)/.test(text)) add("pull_up_bar", "hangs from a pull-up bar");
  if (/parallel bars|above the bars/.test(text)) add("dip_station", "on parallel (dip) bars");
  if (/\bsuspended\b|\brings?\b|suspension straps|with straps/.test(text)) add("suspension_trainer", "rings or suspension straps");
  if (/\bsled\b|prowler/.test(text)) add("sled", "a loaded sled");
  if (STRONGMAN_IMPLEMENT.test(name)) add("strongman_implements", "a strongman implement");
  if (/-smr\b/.test(name)) add("foam_roller", "self-myofascial release with a roller");
  if (/rope jumping|jump rope|skipping rope/.test(name)) add("jump_rope", "skipping with a rope");
  if (/\bplates?\b/.test(name) || /weight plate|barbell plate|olympic plate|\bplates\b/.test(text)) add("barbell", "weight plates (barbell and plates)");
  if (/trap bar|hex bar/.test(text)) add("barbell", "a trap bar");
  if (/\bdumbbell\b/.test(name)) add("dumbbell", "a dumbbell named in the title");
  if (/\bbands?\b/.test(name) && !/\bit band\b/.test(name)) add("resistance_band", "a resistance band");
  if (/exercise ball|stability ball/.test(text)) add("stability_ball", "an exercise ball");
  if (/\bchair\b/.test(name) || /\bsit (upright )?(in|on) (a|the edge of a) chair\b/.test(text)) add("chair", "performed on a chair");
  if (/bar in a rack|bar on a rack/.test(text)) { add("barbell", "a bar set in a rack"); add("squat_rack", "a bar set in a rack"); }
  if (PLATFORM_NAME.test(name) || /\bbox(es)?\b/.test(text) || BOX_OR_BENCH.test(text)) add("box", "a box, step or bench to stand, jump or lean on");
  else if (/\bbench\b/.test(name) || /\b(lie|lying|lay|sit|seated|sitting|place|position)\b[^.]{0,60}\b(flat |decline |incline )?bench\b|decline bench/.test(text)) {
    add("bench", "lies, sits or braces on a bench");
  }
  if (tags.includes("other") && keys.size === 0) {
    if (/\bcones?\b|small barriers|cone or hurdle/.test(text)) why.push("other: cones or small markers, no equipment");
    else add("specialty", "other: nothing more specific is named");
  }
  return { keys: [...keys], why };
}

// ---------------------------------------------------------------- category

/**
 * The import stored the upstream "force" in movement_pattern and fell back to the upstream category when
 * force was empty, so these values are the source's own category.
 */
const CATEGORY_IN_PATTERN = new Set(["strength", "stretching", "cardio", "plyometrics", "strongman"]);

const CATEGORY_RULES = [
  ["stretching", "self-myofascial release (SMR / foam roller)", ({ row, name }) => /-smr\b|\bsmr\b/.test(name) || row.equipment.includes("foam_roller")],
  ["stretching", "a stretch named in the title", ({ name }) => /stretch/.test(name)],
  ["stretching", "joint circles (mobility)", ({ name }) => /\bcircles?\b/.test(name)],
  ["olympic", "a clean, snatch or jerk", ({ name }) => /\b(clean|snatch|jerk)\b/.test(name)],
  ["strongman", "a strongman implement or event in the title", ({ name }) => STRONGMAN_IMPLEMENT.test(name) || /\bsled\b|crucifix|farmer/.test(name)],
  ["cardio", "a cardio machine or endurance activity", ({ name }) =>
    /treadmill|stationary|elliptical|stairmaster|step mill|recumbent|bicycling|trail running|skating|rope jumping|jumping jack/.test(name)],
  ["plyometrics", "a jump, hop, bound, throw or sprint drill", ({ name }) =>
    /\b(jumps?|hops?|bound|leap|skip|skipping|throws?|slam|plyo|sprints?|butt kick|chest push|chest pass|push from stance|push-off|drop push|shuffle)\b/.test(name)],
  ["strongman", "moves a sled or strongman implement", ({ keys }) => keys.includes("sled") || keys.includes("strongman_implements")],
  ["stretching", "a held position whose instructions describe a stretch", ({ row, text }) => row.movement_pattern === "static" && /stretch/.test(text)],
];

/** Category from the source and the name; `keys` are the row's derived equipment keys. */
export function ruleCategory(row, keys = []) {
  if (CATEGORY_IN_PATTERN.has(row.movement_pattern)) {
    return { value: row.movement_pattern, why: "source category (kept in movement_pattern by the import)" };
  }
  const context = { row, keys, name: lower(row.name), text: textOf(row) };
  for (const [value, why, test] of CATEGORY_RULES) if (test(context)) return { value, why };
  return { value: "strength", why: "default" };
}

/** Upstream Free Exercise DB categories in FITX terms (used with --upstream). */
export const UPSTREAM_CATEGORY = Object.freeze({
  strength: "strength", powerlifting: "strength", stretching: "stretching", cardio: "cardio",
  plyometrics: "plyometrics", strongman: "strongman", "olympic weightlifting": "olympic",
});

// ---------------------------------------------------------------- mechanic

const ISOLATION_NAME = new RegExp([
  "\\bcurls?\\b", "\\bextensions?\\b", "hyperextensions?", "\\bkickbacks?\\b", "\\braises?\\b", "\\bfl(y|ye|yes|ies)\\b",
  "\\bcross ?over\\b", "\\bbutterfly\\b", "\\bpullover\\b", "\\bshrugs?\\b", "\\bcrunch(es)?\\b", "\\bsit-?ups?\\b",
  "\\bside bends?\\b", "\\btwists?\\b", "\\bwrist\\b", "\\bpinch\\b", "\\bsqueezes?\\b", "\\babduct(or|ion)s?\\b",
  "\\badduct(or|ion)s?\\b", "\\brotations?\\b", "\\bpull apart\\b", "\\bpushdowns?\\b", "\\bpressdowns?\\b",
  "\\bskull ?crushers?\\b", "straight-arm", "\\bconcentration\\b", "\\bpreacher\\b", "\\bcalf\\b", "\\bleg lift\\b",
  "\\bflutter\\b", "\\bscissor kick\\b", "\\btouchers\\b", "\\btucks?\\b", "\\bjackknife\\b", "\\bpull-?in\\b",
  "\\bvacuum\\b", "\\bplank\\b", "\\bside bridge\\b", "\\bdead bug\\b", "\\btriceps? press\\b", "\\btate press\\b",
  "\\blaterals?\\b", "\\biron cross\\b", "\\bpronation\\b", "\\bsupination\\b", "\\bscaption\\b", "\\bflexion\\b",
  "\\boverhead triceps\\b",
].join("|"));
/** Core exercises that move several joints (rollouts, windmills, chops); other core work is isolation. */
const COMPOUND_CORE = /rollout|ab roller|fallout|windmill|bent press|figure 8|pass between|landmine|spell caster|wood ?chop|cable lift|judo flip|otis|press sit-up|spider crawl|turkish|renegade|sledgehammer/;

export function ruleMechanic(row, category) {
  if (category === "stretching" || category === "cardio") return { value: null, why: `${category} has no mechanic` };
  if (category === "olympic" || category === "plyometrics") return { value: "compound", why: `${category} movements are multi-joint` };
  const name = lower(row.name);
  if (row.primary_muscle === "neck") return { value: "isolation", why: "neck work" };
  if (row.primary_muscle === "abdominals" || row.primary_muscle === "core") {
    return COMPOUND_CORE.test(name) ? { value: "compound", why: "multi-joint core movement" } : { value: "isolation", why: "core flexion, rotation or bracing" };
  }
  if (ISOLATION_NAME.test(name)) return { value: "isolation", why: "single-joint movement named in the title" };
  return { value: "compound", why: "default" };
}

// ---------------------------------------------------------------- prescription and dosage

const HOLD_NAME = /\b(plank|side bridge|wall sit|isometric|vacuum|balance board)\b|\bhang\b|\bwalk\b|\bcarry\b|\bdrags?\b(?! curl)|sled push|conan/;

export function rulePrescription(row, category) {
  if (category === "stretching" || category === "cardio") return { value: "time", why: `${category} is timed` };
  if (category === "olympic" || category === "plyometrics") return { value: "reps", why: `${category} is counted in reps` };
  const name = lower(row.name);
  if (HOLD_NAME.test(name) && !/push up to side plank/.test(name)) return { value: "time", why: "a hold, carry or drag" };
  if (row.movement_pattern === "static") return { value: "time", why: "a static hold" };
  return { value: "reps", why: "default" };
}

/** Default work time for timed rows: stretches 30 s, cardio 10 min, holds and carries 30-45 s. */
export function ruleDuration(row, category, prescriptionType) {
  if (prescriptionType !== "time") return null;
  if (category === "stretching") return 30;
  if (category === "cardio") return 600;
  return row.difficulty === "beginner" ? 30 : 45;
}

/** Sets, reps and rest for imported rows, replacing the import's blanket 3 x 8-12 / 90 s. */
export function ruleDosage(category, mechanic, prescriptionType, durationSeconds) {
  if (prescriptionType === "time") {
    if (category === "stretching") return { recommended_sets: 2, reps_min: 1, reps_max: 1, rest_seconds: 15 };
    if (category === "cardio") return { recommended_sets: durationSeconds >= 300 ? 2 : 3, reps_min: 1, reps_max: 1, rest_seconds: 60 };
    if (category === "strongman") return { recommended_sets: 3, reps_min: 1, reps_max: 1, rest_seconds: 120 };
    return { recommended_sets: 3, reps_min: 1, reps_max: 1, rest_seconds: 60 };
  }
  if (category === "plyometrics") return { recommended_sets: 3, reps_min: 5, reps_max: 8, rest_seconds: 90 };
  if (category === "olympic") return { recommended_sets: 4, reps_min: 3, reps_max: 5, rest_seconds: 150 };
  if (category === "strongman") return { recommended_sets: 3, reps_min: 3, reps_max: 5, rest_seconds: 150 };
  return mechanic === "isolation"
    ? { recommended_sets: 3, reps_min: 10, reps_max: 15, rest_seconds: 60 }
    : { recommended_sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 120 };
}
