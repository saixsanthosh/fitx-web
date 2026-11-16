// Curated corrections to the rules in rules.mjs, each with a short reason. Rows are named exactly as in
// the source migrations; the build fails on a name it cannot find, so a typo cannot slip through.
// Order of precedence for every field: this file, then the upstream classification (when present),
// then the rules.

/** Category corrections: name -> [category, reason]. */
export const CATEGORY = {
  "90/90 Hamstring": ["stretching", "an active hamstring stretch"],
  "Ankle On The Knee": ["stretching", "a held glute stretch"],
  "Elbows Back": ["stretching", "a standing chest stretch"],
  "Looking At Ceiling": ["stretching", "a kneeling back-bend stretch"],
  "Standing Toe Touches": ["stretching", "a hanging hamstring stretch"],
  "The Straddle": ["stretching", "a seated straddle stretch"],
  "Lying Crossover": ["stretching", "a partner-assisted (PNF) hip stretch"],
  "One Handed Hang": ["stretching", "a lat stretch hanging from one hand, feet on the floor"],
  "Downward Facing Balance": ["stretching", "a position held over an exercise ball"],
  "Hug A Ball": ["stretching", "a supported hip and back stretch on an exercise ball"],
  "Pyramid": ["stretching", "a back stretch draped over an exercise ball"],
  "Crossover Reverse Lunge": ["stretching", "a dynamic warm-up lunge with a trunk rotation"],
  "Windmills": ["stretching", "a dynamic lying leg-crossover warm-up"],
  "Front Leg Raises": ["stretching", "leg swings for dynamic flexibility"],
  "Side Leg Raises": ["stretching", "leg swings for dynamic flexibility"],
  "Shoulder Raise": ["stretching", "a shoulder-shrug mobility drill"],
  "Kneeling Arm Drill": ["plyometrics", "a sprint arm-action drill"],
  "Linear 3-Part Start Technique": ["plyometrics", "a sprint-start drill"],
  "Split Squats": ["plyometrics", "jumping split squats (switch lunges)"],
  "Groiners": ["plyometrics", "jumps the feet in to the hands from a push-up position"],
  "Clock Push-Up": ["plyometrics", "an airborne push-up that hops around a circle"],
  "Heavy Bag Thrust": ["plyometrics", "an explosive push against a heavy bag"],
  "Medicine Ball Full Twist": ["plyometrics", "a rotational medicine-ball pass with a partner"],
  "Wind Sprints": ["strength", "hanging alternate knee raises, not a sprint"],
  "Mountain Climbers": ["cardio", "a conditioning drill done for time"],
  "Battling Ropes": ["cardio", "a conditioning drill done in timed intervals"],
  "Front Squat (Clean Grip)": ["strength", "a front squat; only the grip comes from the clean"],
  "Overhead Squat": ["olympic", "trains the snatch receiving position"],
  "Push Press": ["olympic", "a jerk-family lift"],
  "Push Press - Behind the Neck": ["olympic", "a jerk-family lift"],
  "Rack Delivery": ["olympic", "a clean and jerk rack-position drill"],
  "Sled Row": ["strength", "a row against a light sled, not a strongman event"],
  "Sled Reverse Flye": ["strength", "a rear-delt fly against a light sled, not a strongman event"],
  "Sled Overhead Triceps Extension": ["strength", "a triceps extension against a sled, not a strongman event"],
};

/** Mechanic corrections: name -> [mechanic, reason]. */
export const MECHANIC = {
  "Bent-Arm Barbell Pullover": ["compound", "the elbows bend and extend with the shoulder"],
  "Bent-Arm Dumbbell Pullover": ["compound", "the elbows bend and extend with the shoulder"],
  "Push Up to Side Plank": ["compound", "a push-up, then a rotation into a side plank"],
  "Step-up with Knee Raise": ["compound", "a step-up; the knee raise is a finish"],
  "Power Partials": ["isolation", "partial lateral raises"],
  "Body-Up": ["isolation", "elbow extension from a forearm plank"],
  "Monster Walk": ["isolation", "banded hip abduction steps"],
  "Crucifix": ["isolation", "a lateral-raise hold"],
  "Prone Manual Hamstring": ["isolation", "a partner-resisted leg curl"],
  "Platform Hamstring Slides": ["isolation", "a sliding leg curl"],
  "Superman": ["isolation", "back extension only"],
  "Car Drivers": ["isolation", "a plate held out and turned like a steering wheel"],
  "Around The Worlds": ["isolation", "shoulder circles with the arms straight"],
  "Scapular Pull-Up": ["isolation", "shoulder-blade depression only"],
};

/** Prescription corrections: name -> [reps | time, reason]. */
export const PRESCRIPTION = {
  "Isometric Wipers": ["reps", "shifts side to side for repetitions"],
  "Lower Back Curl": ["reps", "the instructions ask for 10-20 repetitions"],
  "Superman": ["reps", "two-second holds, repeated"],
  "Standing Olympic Plate Hand Squeeze": ["reps", "repeated squeezes"],
  "Prone Manual Hamstring": ["reps", "a partner-resisted leg curl"],
  "Monster Walk": ["reps", "counted in steps"],
  "Sledgehammer Swings": ["time", "tire strikes for a timed interval"],
};

/** Default work time corrections for timed rows: name -> [seconds, reason]. */
export const DURATION = {
  "Jumping Jack": [30, "a short interval, matching the starter's 20-40 repetitions"],
  "Rope Jumping": [60, "skipping intervals"],
  "Mountain Climbers": [30, "a short interval"],
  "Battling Ropes": [30, "a short interval"],
};

/** Required equipment corrections: name -> [keys, reason]. Empty means no equipment. */
export const EQUIPMENT = {
  // Starter rows whose legacy tags listed alternatives rather than items that are all needed.
  "Goblet Squat": [["dumbbell"], "either weight works; the kettlebell version is a substitution"],
  "Lat Pulldown": [["cable_machine"], "one cable station, not a cable plus a machine"],
  "Seated Cable Row": [["cable_machine"], "one cable station, not a cable plus a machine"],

  // Bodyweight, untagged and "other" rows.
  "Crucifix": [["dumbbell"], "practised with dumbbells; event axes or hammers are optional"],
  "Donkey Calf Raises": [["machine"], "a donkey calf raise machine"],
  "Farmer's Walk": [["dumbbell"], "heavy dumbbells when farmer's handles are not available"],
  "Hyperextensions (Back Extensions)": [["specialty"], "a hyperextension bench (roman chair); the plate is optional"],
  "Hyperextensions With No Hyperextension Bench": [["bench"], "a flat bench and a partner; the plate is optional"],
  "Knee/Hip Raise On Parallel Bars": [["dip_station"], "a vertical knee-raise station with parallel bars"],
  "London Bridges": [["box", "specialty"], "a climbing rope above a box or locked Smith bar"],
  "Natural Glute Ham Raise": [["machine"], "ankles hooked under a lat pulldown pad"],
  "Otis-Up": [["dumbbell"], "a weight held at the chest; a dumbbell works"],
  "Platform Hamstring Slides": [[], "a towel on a smooth floor"],
  "Power Stairs": [["strongman_implements"], "a power-stairs implement; the box is only a substitute"],
  "Seated Head Harness Neck Resistance": [["barbell", "bench", "specialty"], "plates hung from a neck harness"],
  "Standing Gastrocnemius Calf Stretch": [["box"], "the heel rests on a step"],
  "Weighted Bench Dip": [["dumbbell", "bench"], "two benches and a dumbbell on the lap"],
  "Weighted Pull Ups": [["pull_up_bar", "specialty"], "added weight on a dip belt"],
  "Weighted Squat": [["bench", "specialty"], "stands on two benches with a weight belt"],

  // Free weights, cables and bands.
  "Board Press": [["barbell", "bench", "specialty"], "boards to press to"],
  "Hanging Bar Good Morning": [["barbell", "squat_rack", "specialty"], "the bar hangs in the rack from chains or straps"],
  "Landmine 180's": [["barbell"], "a landmine, or a bar anchored in a corner"],
  "Landmine Linear Jammer": [["barbell"], "a landmine, or a bar anchored in a corner"],
  "Single-Arm Linear Jammer": [["barbell"], "a landmine, or a bar anchored in a corner"],
  "Frankenstein Squat": [["barbell", "squat_rack"], "a front squat taken from a rack"],
  "Speed Box Squat": [["barbell", "resistance_band", "box", "squat_rack"], "bands anchored to the bar"],
  "Chair Squat": [["smith_machine"], "the bar is unlocked like a Smith machine"],
  "Lunge Sprint": [["smith_machine"], "jump lunges in a Smith machine"],
  "One-Arm Side Laterals": [["dumbbell"], "the bench is only something to hold"],
  "Standing Palm-In One-Arm Dumbbell Press": [["dumbbell"], "the bench is only something to hold"],
  "Bosu Ball Cable Crunch With Side Bends": [["cable_machine", "specialty"], "a BOSU ball"],
  "Cable Internal Rotation": [["cable_machine"], "seated on the floor; the bench is optional"],
  "Elevated Cable Rows": [["cable_machine", "box"], "a step platform on the row seat"],
  "Full Range-Of-Motion Lat Pulldown": [["cable_machine"], "standing or seated"],
  "Low Cable Triceps Extension": [["cable_machine"], "lies on the row machine's own bench"],
  "Hip Lift with Band": [["resistance_band", "squat_rack"], "the band is anchored to the rack"],
  "Speed Band Overhead Triceps": [["resistance_band"], "stand on the band; the bench is only an anchor"],
  "Weighted Ball Hyperextension": [["barbell", "stability_ball"], "a weight plate held at the chest"],
  "Weighted Ball Side Bend": [["barbell", "stability_ball"], "a weight plate held at the head"],
  "Weighted Crunches": [["medicine_ball"], "the bench is optional"],
};

/**
 * Imported rows that are the same movement as a starter row under another name. The starter id survives
 * (user plans reference it); the duplicate is hidden and points at it. [duplicate name, survivor id, reason]
 */
export const DUPLICATES = [
  ["Barbell Bench Press - Medium Grip", "bench_press", "the standard medium-grip bench press"],
  ["Pushups", "push_up", "the same push-up"],
  ["Wide-Grip Lat Pulldown", "lat_pulldown", "an overhand pulldown to the chest; its instructions cover every grip width"],
  ["Pullups", "pull_up", "the same pull-up"],
  ["Bent Over Barbell Row", "barbell_row", "the same bent-over barbell row"],
  ["Seated Cable Rows", "seated_cable_row", "the same seated cable row"],
  ["Barbell Squat", "barbell_back_squat", "the standard back squat from a rack"],
  ["Butt Lift (Bridge)", "glute_bridge", "the same bodyweight glute bridge"],
  ["Barbell Hip Thrust", "hip_thrust", "the same barbell hip thrust from a bench"],
  ["Side Lateral Raise", "lateral_raise", "the same standing dumbbell lateral raise"],
  ["Lateral Raise - With Bands", "band_lateral_raise", "the same band lateral raise"],
  ["Dumbbell Bicep Curl", "biceps_curl", "the same standing dumbbell curl"],
  ["Standing Dumbbell Triceps Extension", "triceps_extension", "the same two-hand overhead dumbbell extension"],
  ["Plank", "plank", "the same forearm plank"],
  ["Bodyweight Walking Lunge", "walking_lunge", "the same bodyweight walking lunge"],
];

/**
 * Starter rows that name a whole group ("back", "core") as their primary muscle get the specific
 * muscle the movement trains, so programme slots can tell a vertical pull from a row: id -> [muscle, reason].
 */
export const PRIMARY_MUSCLE = {
  pull_up: ["lats", "a vertical pull"],
  lat_pulldown: ["lats", "a vertical pull"],
  barbell_row: ["middle_back", "a horizontal row"],
  one_arm_dumbbell_row: ["middle_back", "a horizontal row"],
  seated_cable_row: ["middle_back", "a horizontal row"],
  band_row: ["middle_back", "a horizontal row"],
  plank: ["abdominals", "an anti-extension hold for the abdominals"],
  dead_bug: ["abdominals", "an anti-extension exercise for the abdominals"],
};

/**
 * Starter alternatives that point at ids that never existed: id -> [replacement exercise name | null, reason].
 * null drops the reference. A band movement maps to the same movement on a cable.
 */
export const ALTERNATIVES = {
  incline_push_up: ["Incline Push-Up", "the catalogue's incline push-up"],
  dumbbell_fly: ["Dumbbell Flyes", "the catalogue's flat dumbbell fly"],
  assisted_pull_up: ["Band Assisted Pull-Up", "the assisted pull-up in the catalogue"],
  band_lat_pulldown: ["Lat Pulldown", "the same pulldown on a cable (dropped where it would repeat)"],
  cable_row: ["Seated Cable Row", "the starter seated cable row"],
  leg_press: ["Leg Press", "the catalogue's leg press"],
  pike_push_up: [null, "no pike push-up in the catalogue (handstand push-ups are not equivalent)"],
  machine_shoulder_press: ["Machine Shoulder (Military) Press", "the catalogue's machine shoulder press"],
  cable_lateral_raise: ["Standing Low-Pulley Deltoid Raise", "a standing one-arm cable lateral raise"],
  band_curl: ["Standing Biceps Cable Curl", "the same curl on a cable (dropped where it would repeat)"],
  cable_curl: ["Standing Biceps Cable Curl", "the catalogue's standing cable curl"],
  close_grip_push_up: ["Push-Ups - Close Triceps Position", "the catalogue's close-grip push-up"],
  band_pressdown: ["Triceps Pushdown", "the same pressdown on a cable"],
  side_plank: ["Side Bridge", "a side bridge is a side plank"],
  bird_dog: [null, "no bird dog in the catalogue"],
  march_in_place: [null, "no marching drill in the catalogue"],
  single_leg_calf_raise: [null, "no standing single-leg calf raise in the catalogue"],
};

/**
 * Starter rows keep their curated sets, reps and rest except clear errors. Timed rows log one effort per
 * set (reps 1-1): the starter plank stored its 20-60 seconds as repetitions.
 */
export const STARTER_TIMED_REPS = { reps_min: 1, reps_max: 1 };
