// demo-priority.mjs: the committed priority.json is exactly what the repo data gives, with its counts and prices;
// every caption comes from the exercise's own catalogue steps or FITX's reviewed demo-script words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIORITY_FILE, buildPriority, loadRepoData, priceFor, serialise, KEEP_STAND_IN, SAME_MOVEMENT_STAND_INS } from "./demo-priority.mjs";
import { CAPTION_MAX, fitCaption, fitxWrittenCaptions, stepCaptions } from "./demos/captions.mjs";

const data = await loadRepoData();
const priority = buildPriority(data);
const committed = readFileSync(PRIORITY_FILE, "utf8");

test("the committed priority.json is up to date with the repo data", () => {
  assert.equal(committed, serialise(priority), "run node scripts/media/demo-priority.mjs --write");
});

test("tiers: Form Check, staples, programmes and the bodyweight Home collection; the Home counts are reported", () => {
  assert.equal(priority.tiers.T1.count, 32);
  assert.equal(priority.tiers.T2.count, 90);
  assert.equal(priority.tiers.T4.count, data.homeBodyweight.length);
  assert.equal(priority.home.bodyweightOnly, priority.tiers.T4.count);
  assert.equal(priority.home.everyHomeItemOwned, data.homeAllOwned.length);
  assert.ok(priority.home.everyHomeItemOwned > priority.home.bodyweightOnly);
  assert.equal(priority.home.leftOutCount, priority.home.leftOut.length);
  const inSet = new Set(priority.set.map((item) => item.id));
  for (const id of priority.home.leftOut) assert.ok(!inSet.has(id) && data.homeAllOwned.includes(id), id);
  for (const id of priority.tiers.T3.outsideT2) assert.ok(!priority.tiers.T2.ids.includes(id));
});

test("the set: T1 ∪ T2 ∪ T4, active ids with a reference; the rest dropped with a reason", () => {
  const ids = priority.set.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicates");
  assert.equal(ids.length + priority.dropped.length, priority.union.T1_T2_T4);
  const active = new Set(data.active.map((exercise) => exercise.id));
  for (const id of ids) assert.ok(active.has(id), `${id} is active`);
  for (const drop of priority.dropped) assert.ok(drop.reason, drop.id);
  assert.ok(ids.includes("jumping_jack"));
  assert.deepEqual(priority.set.find((item) => item.id === "jumping_jack").reference, { kind: "fitx", files: ["public/media/form-check/jumping-jack-closed.webp", "public/media/form-check/jumping-jack-open.webp"] });
  for (const id of SAME_MOVEMENT_STAND_INS) assert.equal(priority.set.find((item) => item.id === id)?.reference.kind, "free-exercise-db-stand-in", id);
  for (const id of KEEP_STAND_IN) assert.match(priority.dropped.find((item) => item.id === id)?.reason ?? "", /labelled stand-in/, id);
  for (const item of priority.set.filter((entry) => entry.reference.kind !== "fitx")) {
    for (const url of item.reference.files) assert.ok(url.startsWith("https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/"), url);
  }
});

test("prices: four images an exercise, the brief's call cap, priority and all", () => {
  assert.deepEqual(priceFor(150), { exercises: 150, images: 600, calls: 770, usdFirstTry: 23.4, usdCap: 30.03, estimatedBytes: 600 * 40 * 1024 });
  assert.deepEqual(priority.price.priority, priceFor(priority.set.length));
  assert.equal(priority.counts.allActive, data.active.length);
  assert.deepEqual(priority.price.all, priceFor(priority.counts.allWithReference));
  assert.equal(buildPriority(data, { limit: "all" }).set.length, priority.counts.allWithReference);
});

test("every caption is a substring of the exercise's tidied steps or a reviewed FITX demo-script caption", () => {
  const fitx = fitxWrittenCaptions(data.formCheck);
  for (const item of priority.set) {
    const steps = data.guideSteps(data.instructions.get(item.id) ?? []).map((step) => step.text).join("\n");
    for (const caption of item.captions) {
      if (!caption) continue;
      assert.ok(caption.length <= CAPTION_MAX, `${item.id}: ${caption}`);
      assert.ok(fitx.has(caption) || steps.includes(caption), `${item.id}: "${caption}" is not from its steps or the FITX list`);
    }
  }
  assert.deepEqual(priority.captions.needsWriting, priority.set.filter((item) => !item.captions[0] || !item.captions[1]).map((item) => item.id));
});

test("caption picking: the starting-position step, then the next step; long leads cut only at a clause", () => {
  const step = (text) => ({ text, lead: text.split(". ")[0] + (text.includes(". ") ? "." : ""), rest: "" });
  assert.deepEqual(stepCaptions([step("Grab the bar. This will be your starting position."), step("Pull up."), step("Repeat for the recommended amount of repetitions.")]), ["Grab the bar.", "Pull up."]);
  assert.deepEqual(stepCaptions([step("For this exercise you will need a bench."), step("Lie on the bench."), step("Press.")]), ["Lie on the bench.", "Press."]);
  const long = `Hold the dumbbells at your sides with your palms facing in, keeping your elbows close to your torso ${"and steady ".repeat(6)}`.trim();
  const cut = fitCaption(long);
  assert.ok(cut.length <= CAPTION_MAX && long.includes(cut) && cut.length > 0, cut);
  assert.equal(fitCaption("x".repeat(200)), "", "no clause to cut at: left for a person to write");
});
