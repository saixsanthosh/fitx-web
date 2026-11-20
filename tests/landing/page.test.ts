// The landing page's media, food example and copy rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { LANDING_MEDIA } from "@/data/landing-media";
import { pieceFoodFrom, portionNutrition } from "@/components/landing/portion";

const ROOT = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, ROOT), "utf8");
const staples = JSON.parse(read("src/data/fitx-staples.json"));

test("every landing image is a committed, optimised WebP within the brief's caps", () => {
  const entries = Object.entries(LANDING_MEDIA);
  assert.ok(entries.length > 0 && entries.length <= 12, "at most 12 images");
  let total = 0;
  for (const [id, image] of entries) {
    const file = new URL(`public${image.src}`, ROOT);
    assert.ok(existsSync(file), id);
    assert.match(image.src, /^\/media\/landing\/[a-z0-9-]+\.webp$/);
    const bytes = statSync(file).size;
    assert.ok(bytes <= 350 * 1024, `${id} is ${bytes} bytes`);
    total += bytes;
    assert.ok(Math.max(image.width, image.height) <= 2400);
    assert.match(image.blurDataURL, /^data:image\/webp;base64,/);
    assert.ok(image.alt.length > 10, `${id} has alt text`);
  }
  assert.ok(total <= 4 * 1024 * 1024);
  const onDisk = readdirSync(new URL("public/media/landing/", ROOT)).filter((name) => !name.startsWith("."));
  assert.deepEqual(onDisk.sort(), entries.map(([id]) => `${id}.webp`).sort(), "no stray files");
});

test("the idli example comes from the built-in food list and scales by the piece", () => {
  const idli = pieceFoodFrom(staples.foods, "2708346", { pieceLabel: "idli", source: "USDA" });
  assert.ok(idli);
  assert.equal(idli.pieceGrams, 38);
  const two = portionNutrition(idli, 2);
  assert.equal(two.grams, 76);
  assert.equal(two.kcal, Math.round(128 * 0.76));
  assert.equal(pieceFoodFrom(staples.foods, "no-such-food", { pieceLabel: "x", source: "x" }), null);
  assert.equal(pieceFoodFrom([{ id: "1", name: "x", calories: 10, protein: null, carbs: 1, fat: 1, portions: [{ unit: "piece", grams: 10 }] }], "1", { pieceLabel: "x", source: "x" }), null, "an unknown macro is not shown as 0");
});

test("the landing copy avoids the banned phrases and invented claims", () => {
  const files = ["src/app/(marketing)/page.tsx", ...readdirSync(new URL("src/components/landing/", ROOT)).filter((f) => f.endsWith(".tsx")).map((f) => `src/components/landing/${f}`)];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /Welcome to|Unlock|Supercharge|seamless|journey|all-in-one|AI-powered/i, file);
    assert.doesNotMatch(text, /testimonial|\b\d[\d,]*\+? (users|members|downloads)\b|★/i, file);
  }
  assert.match(read("src/components/landing/DualScenes.tsx"), /Example/, "the sample plan is labelled as an example");
});

test("the scenes and features keep the required promises", () => {
  const features = read("src/components/landing/HomeWorkoutFeatures.tsx");
  assert.match(features, /never uploaded/);
  assert.match(features, /Not medical advice|not medical advice/);
});

test("the Home workout features claim only what the shipped Home workout does", () => {
  // The copy, without the source comments (which may name features still to come).
  const features = read("src/components/landing/HomeWorkoutFeatures.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const coachDirs = ["src/components/form-coach/", "src/components/home-workout/"].filter((dir) => existsSync(new URL(dir, ROOT)));
  const coach = coachDirs.flatMap((dir) => readdirSync(new URL(dir, ROOT)).filter((f) => /\.tsx?$/.test(f)).map((f) => read(`${dir}${f}`))).join("\n");
  assert.ok(coach.length > 0, "the Home workout code is found");
  // A claim on the left needs the code on the right before the landing page may make it.
  const claims: Array<[RegExp, RegExp, string]> = [
    [/\b(fe)?male\b|choose (a|the) voice/i, /getVoices\s*\(/, "a voice choice"],
    [/\bfigure\b|\bmirrors you\b|beside the demo/i, /demo|figure/i, "a live figure beside a demo"],
    [/\bspoken\b|\bvoice\b/i, /speechSynthesis/, "spoken cues"],
    [/range meter/i, /meter/, "a range meter"],
  ];
  for (const [claim, evidence, what] of claims) {
    if (claim.test(features)) assert.match(coach, evidence, `the landing page claims ${what}, which Home workout does not have yet`);
  }
  assert.match(read("src/lib/pose/landmarks.ts"), /LANDMARK_COUNT = 33\b/, "33 body points");
  assert.match(features, /33 body points/);
});

test("the Home workout exercise count on the landing page is the page's own", async () => {
  const { EXERCISE_RULES } = await import("@/lib/form-rules/catalog");
  const features = read("src/components/landing/HomeWorkoutFeatures.tsx");
  const claimed = features.match(/title: "(\d+) exercises"/)?.[1];
  assert.ok(claimed, "the features name how many exercises there are");
  assert.equal(Number(claimed), EXERCISE_RULES.length, "the landing page's count follows the Home workout catalogue");
  assert.match(read("src/lib/home-workout/catalog.ts"), /HOME_EXERCISES[^\n]*= EXERCISE_RULES\.map/, "every camera rule is a Home workout exercise");
});

test("the home page still mounts the visitor intro film", () => {
  assert.match(read("src/app/(marketing)/page.tsx"), /<CinematicIntro \/>/);
});
