import { describe, test } from "node:test";
import assert from "node:assert/strict";
// The cleaned catalogue exactly as migration 20261118130010 writes it (scripts/catalog), so every case below runs
// against the real exercise names.
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { exerciseRegions } from "@/lib/training/anatomy";
import { toCatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import { EMPTY_QUERY, queryCatalog, type CatalogQuery } from "@/lib/training/catalog-search";
import {
  buildVocabulary,
  coverName,
  editDistance,
  EQUIPMENT_TERMS,
  foldWord,
  highlightRanges,
  isKnownTerm,
  matchExercise,
  MUSCLE_TERMS,
  nameIndex,
  parseSearch,
  suggestSpelling,
  TERM_CLASSES,
  textTokens,
} from "@/lib/training/search-terms";

const catalog = (deriveCatalog() as Array<CatalogRow & { is_active: boolean }>).filter((row) => row.is_active).map(toCatalogExercise);
const names = (q: string, extra: Partial<CatalogQuery> = {}) => queryCatalog(catalog, { ...EMPTY_QUERY, q, ...extra }, { owned: null }).items.map((item) => item.exercise.name);
const exercises = (q: string) => queryCatalog(catalog, { ...EMPTY_QUERY, q }, { owned: null }).items.map((item) => item.exercise);
const top = (q: string, count = 5) => names(q).slice(0, count);
const sameSet = (a: readonly string[], b: readonly string[]) => assert.deepEqual([...a].sort(), [...b].sort());
const lower = (value: string) => value.toLowerCase();

describe("text folding", () => {
  test("case, accents, apostrophes and endings fold the same way for names and searches", () => {
    assert.deepEqual(textTokens("Push-Ups With Feet Elevated"), ["push", "up", "with", "foot", "elevated"]);
    assert.deepEqual(textTokens("Farmer's Walk"), ["farmers", "walk"].map(foldWord));
    assert.deepEqual(["Curls", "Presses", "Crunches", "Flyes", "Flies", "Calves", "Hammies", "Squats", "Lunges", "Dips", "ups"].map(foldWord),
      ["curl", "press", "crunch", "fly", "fly", "calf", "hammy", "squat", "lunge", "dip", "up"]);
    // Words that only look plural stay put, or fold the same on both sides.
    assert.deepEqual(["press", "chest", "abs", "biceps", "triceps"].map(foldWord), ["press", "chest", "ab", "bicep", "tricep"]);
    assert.equal(foldWord("Développé"), "developpe");
    assert.deepEqual(textTokens("3/4 Sit-Up"), ["3", "4", "sit", "up"]);
  });

  test("a name index keeps where each word is, for highlighting", () => {
    const index = nameIndex("Close-Grip Barbell Bench Press");
    assert.deepEqual(index.tokens, ["close", "grip", "barbell", "bench", "press"]);
    assert.equal(index.joined, "closegripbarbellbenchpress");
    assert.deepEqual(highlightRanges("Close-Grip Barbell Bench Press", [3, 4]), [[19, 30]]);
    assert.deepEqual(highlightRanges("Push-Up", [0, 1]), [[0, 7]]);
  });
});

describe("matching a name", () => {
  const cover = (words: string, name: string, exact = false) => coverName(textTokens(words), nameIndex(name), exact);

  test("whole words, joined words, words written apart and partial words", () => {
    assert.equal(cover("bench press", "Barbell Bench Press")?.quality, 1);
    assert.ok(cover("pushup", "Push-Up"), "joined search, spaced name");
    assert.ok(cover("push up", "Pushups (Close and Wide Hand Positions)"), "spaced search, joined name");
    assert.ok(cover("pull down", "Wide-Grip Pulldown Behind The Neck"));
    assert.ok(cover("skull crusher", "EZ-Bar Skullcrusher"));
    assert.ok(cover("skullcrusher", "Band Skull Crusher"));
    assert.ok(cover("benc pre", "Barbell Bench Press"), "partial words");
    assert.ok(cover("press dumbbell", "Dumbbell Bench Press"), "any order");
  });

  test("matches start at a word: no 'row' in 'Throw', no 'rdl' in 'Hurdle'", () => {
    assert.equal(cover("row", "Backward Medicine Ball Throw"), null);
    assert.equal(cover("row", "Narrow Stance Squats"), null);
    assert.equal(cover("rdl", "Hurdle Hops"), null);
    assert.equal(cover("lat", "Dumbbell Lateral Raise", true), null, "muscle words match whole words only");
  });

  test("linking words never stop a match", () => {
    assert.ok(cover("clean and jerk", "Clean and Jerk"));
    assert.ok(cover("squat with dumbbells", "Split Squat with Dumbbells"));
    assert.ok(cover("bench press with chains", "Bench Press with Chains"));
  });
});

describe("the search plan", () => {
  test("known phrases win over single words; other words stay together", () => {
    const kinds = (q: string) => parseSearch(q).terms.map((term) => `${term.kind}:${term.text}`);
    assert.deepEqual(kinds("lat pulldown"), ["phrase:lat pulldown"]);
    assert.deepEqual(kinds("lats"), ["muscle:lat"]);
    assert.deepEqual(kinds("db curl"), ["equipment:db", "words:curl"]);
    assert.deepEqual(kinds("close grip db bench press"), ["words:close grip", "equipment:db", "phrase:bench press"]);
    assert.deepEqual(kinds("trap bar deadlift"), ["phrase:trap bar", "phrase:deadlift"]);
    assert.deepEqual(kinds("lower back"), ["muscle:lower back"]);
    assert.deepEqual(kinds("full body"), ["full_body:full body"]);
    assert.deepEqual(parseSearch("   ").terms, []);
  });

  test("vocabularies: unique phrases, real equipment keys, real regions", () => {
    const seen = new Map<string, string>();
    for (const members of TERM_CLASSES) {
      for (const member of members) {
        const key = textTokens(member).join(" ");
        assert.ok(key, `${member} has words`);
        assert.ok(isKnownTerm(member), `${member} is known`);
        const owner = seen.get(key);
        // A phrase may repeat only in a class that is a wider version of the first (plank and side plank).
        if (owner) assert.ok(members.includes(owner) || owner === members[0] || key === "side plank" || key === "side bridge", `${member} is listed twice`);
        seen.set(key, members[0]);
      }
    }
    for (const term of EQUIPMENT_TERMS) for (const key of term.keys) assert.ok(key === "none" || catalog.some((exercise) => exercise.required_equipment.includes(key)), `${key} is used by an exercise`);
    for (const term of MUSCLE_TERMS) for (const region of term.regions) assert.ok(catalog.some((exercise) => exerciseRegions(exercise.primary_muscle, exercise.secondary_muscles).primary.includes(region)), `${region} is a primary muscle`);
  });
});

describe("synonyms and gym terms, against the real catalogue", () => {
  test("bench, bench press, benchpress and bp all find the bench press", () => {
    const bench = names("bench press");
    assert.ok(bench.length >= 15);
    assert.ok(bench.every((name) => /bench\s*press/i.test(name) || /bench/i.test(name)));
    sameSet(names("benchpress"), bench);
    sameSet(names("bp"), names("bench press").filter((name) => /bench press/i.test(name)));
    for (const q of ["bench", "bench press", "benchpress", "bp", "Bench-Press", "BENCH PRESSES"]) {
      assert.ok(top(q, 3).includes("Barbell Bench Press"), `${q}: ${top(q, 3).join(", ")}`);
    }
  });

  test("db, bb and kb read as dumbbell, barbell and kettlebell", () => {
    for (const [short, long, key] of [["db", "dumbbell", "dumbbell"], ["bb", "barbell", "barbell"], ["kb", "kettlebell", "kettlebell"]] as const) {
      const found = exercises(short);
      assert.ok(found.length > 20, short);
      assert.ok(found.every((exercise) => exercise.required_equipment.includes(key) || lower(exercise.name).includes(long) || lower(exercise.name).split(/\W+/).includes(short)), short);
      sameSet(names(short), names(long));
    }
    assert.ok(top("db curl", 3).every((name) => /dumbbell/i.test(name) && /curl/i.test(name)), top("db curl", 3).join(", "));
    assert.ok(top("bb row", 5).some((name) => name === "Barbell Row"), top("bb row", 5).join(", "));
  });

  test("ohp, overhead press, military press and shoulder press find the same presses", () => {
    const ohp = names("ohp");
    sameSet(ohp, names("overhead press"));
    sameSet(ohp, names("military press"));
    assert.ok(ohp.includes("Standing Military Press") && ohp.includes("Dumbbell Shoulder Press") && ohp.includes("Smith Machine Overhead Shoulder Press"));
    assert.ok(exercises("ohp").every((exercise) => exercise.muscle_group === "shoulders"));
    assert.equal(top("military press", 1)[0].includes("Military"), true, "the words typed come first");
  });

  test("rdl, romanian deadlift and sldl", () => {
    sameSet(names("rdl"), ["Romanian Deadlift", "Dumbbell Romanian Deadlift", "Romanian Deadlift from Deficit"]);
    sameSet(names("RDLs"), names("romanian deadlifts"));
    assert.ok(names("sldl").every((name) => /stiff/i.test(name)) && names("sldl").includes("Stiff-Legged Barbell Deadlift"));
  });

  test("push-up, pushup, push ups and press-up", () => {
    const pushUps = names("push-up");
    for (const q of ["pushup", "push ups", "pushups", "press-up", "press ups", "Push Up"]) assert.equal(top(q, 1)[0], "Push-Up", q);
    assert.ok(pushUps.includes("Pushups (Close and Wide Hand Positions)") && pushUps.includes("Handstand Push-Ups"));
    sameSet(names("pushup"), pushUps);
  });

  test("pull-up, pullup and chin-up find each other, the typed one first", () => {
    assert.equal(top("pull-up", 1)[0], "Pull-Up");
    assert.equal(top("pullups", 1)[0], "Pull-Up");
    assert.equal(top("chin up", 1)[0], "Chin-Up");
    assert.ok(names("pullup").includes("Chin-Up") && names("chin-up").includes("Pull-Up"));
    assert.ok(names("pull ups").includes("V-Bar Pullup"));
    assert.ok(!names("pull up").some((name) => /wrist curl/i.test(name)), "no 'Pulley … Up' noise");
  });

  test("lat pulldown, lat pull down and pulldown", () => {
    assert.equal(top("lat pulldown", 1)[0], "Lat Pulldown");
    sameSet(names("lat pull down"), names("lat pulldown"));
    assert.ok(names("lat pulldown").includes("V-Bar Pulldown"), "a plain pulldown is a synonym");
    assert.ok(top("lat pulldown", 4).every((name) => /lat pulldown/i.test(name)), "the typed phrase first");
  });

  test("skull crusher, skullcrusher and lying triceps extension", () => {
    const found = names("skull crusher");
    sameSet(names("skullcrusher"), found);
    for (const name of ["EZ-Bar Skullcrusher", "Band Skull Crusher", "Lying Triceps Press", "Cable Lying Triceps Extension"]) assert.ok(found.includes(name), name);
    assert.ok(exercises("skull crushers").every((exercise) => exercise.muscle_group === "triceps"));
  });

  test("curl variants: biceps curls, hammer, preacher, EZ, leg and hamstring curls", () => {
    const biceps = exercises("bicep curl");
    assert.ok(biceps.length >= 30 && biceps.every((exercise) => /curl/i.test(exercise.name)));
    assert.ok(["Barbell Curl", "Hammer Curls", "Preacher Curl", "EZ-Bar Curl"].every((name) => biceps.some((exercise) => exercise.name === name)), "curls that train the biceps, whatever their name");
    assert.ok(!biceps.some((exercise) => /leg curl/i.test(exercise.name)));
    assert.ok(top("hammer curls", 3).every((name) => /hammer/i.test(name)));
    assert.ok(names("ez curl").includes("EZ-Bar Curl"));
    sameSet(names("hamstring curl").filter((name) => /leg curl/i.test(name)), names("leg curl").filter((name) => /leg curl/i.test(name)));
  });

  test("squat variants, lunge and split squat", () => {
    assert.ok(names("squats").length >= 40);
    assert.equal(top("back squat", 1)[0], "Barbell Back Squat");
    assert.ok(names("air squat").includes("Bodyweight Squat"));
    assert.ok(top("goblet squat", 1)[0] === "Goblet Squat");
    const lunges = names("lunges");
    assert.ok(lunges.includes("Walking Lunge") && lunges.includes("Split Squat"), "a split squat is a synonym of a lunge");
    assert.ok(names("split squat").includes("Walking Lunge"));
    assert.ok(top("split squat", 2).every((name) => /split squat/i.test(name)));
    assert.ok(names("bulgarian split squat").includes("Split Squat"));
  });

  test("plank, side plank, crunch and sit-up", () => {
    assert.ok(names("plank").includes("Front Plank") && names("plank").includes("Side Bridge"));
    sameSet(names("side plank"), ["Push Up to Side Plank", "Side Bridge"]);
    const crunch = names("crunch");
    assert.equal(crunch[0], "Crunches");
    assert.ok(crunch.includes("Sit-Up") && names("sit-ups").includes("Crunches"));
    assert.equal(top("situp", 1)[0], "Sit-Up");
  });

  test("hip thrust and glute bridge, calf raise, face pull, shrug and dip", () => {
    assert.equal(top("hip thrusts", 1)[0], "Hip Thrust");
    assert.ok(names("hip thrust").includes("Glute Bridge") && names("glute bridge").includes("Hip Thrust"));
    assert.ok(names("calf raises").length >= 10 && exercises("calf raise").every((exercise) => exercise.muscle_group === "calves"));
    assert.ok(names("calf raise").includes("Calf Press On The Leg Press Machine"), "calf press is a synonym");
    assert.deepEqual(names("face pulls"), ["Face Pull"]);
    assert.deepEqual(names("facepull"), ["Face Pull"]);
    assert.ok(names("shrugs").length >= 8 && names("shrugs").every((name) => /shrug/i.test(name)));
    assert.ok(names("dips").includes("Bench Dips") && names("dips").includes("Dips - Chest Version"));
    assert.ok(names("tricep dips").slice(0, 3).includes("Dips - Triceps Version"));
  });

  test("fly, pec deck and lateral raise", () => {
    assert.ok(names("flyes").includes("Cable Fly") && names("fly").includes("Dumbbell Flyes"));
    assert.ok(names("pec deck").includes("Butterfly"));
    const lateral = names("lat raise");
    assert.ok(lateral.length > 0 && lateral.every((name) => /lateral|side/i.test(name)), lateral.join(", "));
  });
});

describe("muscle words filter and rank", () => {
  const primaryOf = (exercise: { primary_muscle: string; secondary_muscles: string[] }) => exerciseRegions(exercise.primary_muscle, exercise.secondary_muscles);

  test("pecs, lats, quads, hammies, glutes, delts, abs and traps find exercises for that muscle, main muscle first", () => {
    const cases: Array<[string, string]> = [["pecs", "chest"], ["lats", "lats"], ["quads", "quadriceps"], ["hammies", "hamstrings"], ["glutes", "glutes"], ["delts", "shoulders"], ["abs", "abdominals"], ["traps", "traps"], ["obliques", "abdominals"]];
    for (const [word, region] of cases) {
      const found = exercises(word);
      assert.ok(found.length >= 8, `${word}: ${found.length}`);
      const firstTen = found.slice(0, 10);
      assert.ok(firstTen.every((exercise) => primaryOf(exercise).primary.includes(region as never)), `${word}: the first results train it as the main muscle (${firstTen.map((exercise) => exercise.name).join(", ")})`);
      // Exercises that only assist come after every main-muscle one.
      const tiers = found.map((exercise) => (primaryOf(exercise).primary.includes(region as never) ? 0 : 1));
      assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b), `${word}: main muscle before assisting`);
    }
    sameSet(names("obliques"), names("abs"));
  });

  test("a muscle word in a name does not make it that muscle's exercise", () => {
    const chest = names("chest");
    assert.ok(chest.indexOf("Barbell Bench Press") < chest.indexOf("Chin To Chest Stretch"), "a neck stretch with 'chest' in its name comes after real chest exercises");
    assert.ok(!names("lats").includes("Dumbbell Lateral Raise"), "'lat' is not 'lateral'");
  });

  test("muscle and exercise words together: chest press, leg press, back squat, calf raise", () => {
    assert.ok(top("chest press", 6).some((name) => /bench press|chest press/i.test(name)));
    assert.equal(top("leg press", 1)[0], "Leg Press");
    assert.ok(exercises("glute kickback").every((exercise) => /kickback/i.test(exercise.name)));
  });

  test("full body uses the catalogue's full-body rule", () => {
    const found = exercises("full body");
    assert.ok(found.length > 40);
    assert.ok(found.some((exercise) => exercise.category === "olympic"));
  });
});

describe("partial names, misspellings and highlighting", () => {
  test("partial names find while the member is still typing", () => {
    assert.ok(top("benc", 3).includes("Barbell Bench Press"));
    assert.ok(top("bench pr", 3).includes("Barbell Bench Press"));
    assert.ok(names("romanian dead").includes("Romanian Deadlift"));
    assert.ok(names("hamm").includes("Hammer Curls"));
  });

  test("a misspelt search suggests the words the catalogue uses", () => {
    const vocabulary = buildVocabulary(catalog.map((exercise) => exercise.name));
    assert.equal(names("bech pres").length, 0);
    assert.equal(suggestSpelling("bech pres", vocabulary), "bench press", "a partly typed word is completed in the suggestion");
    assert.ok(names(suggestSpelling("bech pres", vocabulary)!).includes("Barbell Bench Press"));
    assert.equal(suggestSpelling("skwat", vocabulary), "squat");
    assert.equal(suggestSpelling("dumbell curl", vocabulary), null, "a common misspelling is already understood");
    assert.ok(names("dumbell curl").length > 0);
    assert.equal(suggestSpelling("bench press", vocabulary), null);
    assert.equal(editDistance("benhc", "bench"), 1, "swapped letters are one edit");
  });

  test("matches mark the words found in the name", () => {
    const exercise = catalog.find((item) => item.name === "Barbell Bench Press")!;
    const match = matchExercise(exercise, parseSearch("benchpress"))!;
    assert.deepEqual(highlightRanges(exercise.name, match.matched), [[8, 19]]);
    const muscle = matchExercise(exercise, parseSearch("pecs"))!;
    assert.deepEqual(muscle.matched, [], "nothing to mark when the muscle list matched");
  });
});
