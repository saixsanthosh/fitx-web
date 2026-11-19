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

test("the home page still mounts the visitor intro film", () => {
  assert.match(read("src/app/(marketing)/page.tsx"), /<CinematicIntro \/>/);
});
