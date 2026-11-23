// generate-demos.mjs with fixtures only: no key file, no network, no model call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  DEFAULT_IMAGE_MODEL, DEMO_MAX_BYTES, capsFor, demoPrompt, demoRequestBody, emptyLedger, encodeDemo, encodedFile, endpointFor, jobKey,
  parseArgs, personaPrompt, planJobs, rawFile, readLedger, referenceFile, requireCaps, runJobs, stopReason, writeLedger, approvedPersonas, personaFile,
  approvedPersonasFile, sha256, downloadReferences,
} from "./generate-demos.mjs";

const KEY = "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345";
const item = (id, ref = id) => ({ id, name: id.replace(/_/g, " "), tiers: ["T1"], reference: { kind: "free-exercise-db", ref, files: [0, 1].map((n) => `https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/${ref}/${n}.jpg`) }, captions: ["a", "b"] });

/** A smooth gradient PNG (compresses well) or noise (does not). */
async function png(width, height, noise = false) {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let i = 0; i < width * height; i += 1) {
    for (let c = 0; c < channels; c += 1) data[i * channels + c] = noise ? Math.floor(Math.random() * 256) : Math.round(((i % width) / width) * 200 + c * 20);
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

function workDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fitx-demos-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

async function seedReferences(work, items) {
  const photo = await png(400, 300);
  for (const it of items) for (const frame of [0, 1]) {
    const file = referenceFile(work, it, frame);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, photo);
  }
}

/** A fake generateContent endpoint: records every request, answers with a small image. */
function fakeModel(image) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, headers: init.headers, body: init.body });
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: image.toString("base64") } }] } }] }) };
  };
  return { requests, fetchImpl };
}

const personas = { male: { mimeType: "image/png", data: "UEVSU09OQQ==" }, female: { mimeType: "image/png", data: "UEVSU09OQg==" } };

test("the request: the prompt first, then each reference image in order; the key is never in a body", () => {
  const body = demoRequestBody("prompt", [{ mimeType: "image/png", data: "AAA" }, { mimeType: "image/jpeg", data: "BBB" }, { mimeType: "image/png", data: "CCC" }]);
  const parts = body.contents[0].parts;
  assert.equal(parts.length, 4);
  assert.deepEqual(parts[0], { text: "prompt" });
  assert.deepEqual(parts.slice(1).map((part) => [part.inline_data.mime_type, part.inline_data.data]), [["image/png", "AAA"], ["image/jpeg", "BBB"], ["image/png", "CCC"]]);
  assert.equal(body.generationConfig.imageConfig.aspectRatio, "4:3");
  assert.ok(!JSON.stringify(body).includes(KEY));
  assert.equal(endpointFor(DEFAULT_IMAGE_MODEL), "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
});

test("prompts reproduce the reference pose and never ask the model to move it", () => {
  for (const frame of [0, 1]) {
    const text = demoPrompt(item("push_up"), "female", frame);
    assert.match(text, /Reproduce exactly the pose in image 2/);
    assert.match(text, /Change only the person/);
    assert.match(text, /Do not change, correct, exaggerate or move the pose/);
    assert.doesNotMatch(text, /\b(lower|raise|move) (the|your|their) (arms|body|hips)\b/i);
  }
  assert.match(demoPrompt(item("push_up"), "male", 1), /Image 3 is the same person already photographed in the start position/);
  assert.match(personaPrompt("male"), /fictional and is not any real or famous person/);
  assert.match(personaPrompt("female"), /No logos/);
});

test("arguments: caps are required for any run that may call the model; unknown models are refused", () => {
  assert.throws(() => requireCaps(parseArgs(["--set=ids:push_up"])), /--max-calls and --budget-usd/);
  assert.throws(() => requireCaps(parseArgs(["--max-calls=10"])), /--max-calls and --budget-usd/);
  assert.doesNotThrow(() => requireCaps(parseArgs(["--dry-run"])));
  assert.doesNotThrow(() => requireCaps(parseArgs(["--max-calls=10", "--budget-usd=0.5"])));
  assert.throws(() => parseArgs(["--image-model=gemini-3-pro-image"]), /owner's OK/);
  assert.throws(() => parseArgs(["--set=everything"]), /--set=/);
  assert.throws(() => parseArgs(["--model=both-ish"]), /--model=/);
  assert.deepEqual(parseArgs(["--set=ids:a,b", "--model=female", "--limit=3"]).set, "ids:a,b");
});

test("the brief's caps: ceil(1.25 x images) + 20 calls at US$0.039", () => {
  assert.deepEqual(capsFor(600), { images: 600, calls: 770, usdFirstTry: 23.4, usdCap: 30.03 });
  assert.deepEqual(capsFor(3532), { images: 3532, calls: 4435, usdFirstTry: 137.75, usdCap: 172.97 });
  assert.deepEqual(capsFor(0), { images: 0, calls: 0, usdFirstTry: 0, usdCap: 0 });
});

test("the encoder: 4:3 WebP within the 40 KB target, stepping quality then size; over the target it says so", async () => {
  assert.equal(DEMO_MAX_BYTES, 40 * 1024);
  const smooth = await encodeDemo(sharp, await png(1600, 1200));
  assert.equal(smooth.ok, true);
  assert.ok(smooth.bytes <= DEMO_MAX_BYTES, `${smooth.bytes} bytes`);
  assert.deepEqual([smooth.width, smooth.height], [1200, 900]);
  assert.equal((await sharp(smooth.data).metadata()).format, "webp");
  const noisy = await encodeDemo(sharp, await png(1600, 1200, true));
  assert.equal(noisy.ok, false);
  assert.deepEqual([noisy.width, noisy.height, noisy.quality], [1000, 750, 30], "it tried down to quality 30 at 1000 px");
});

test("a run makes start frames before end frames, sends the key only in the header and writes the ledger", async () => {
  const { dir, done } = workDir();
  try {
    const items = [item("push_up"), item("plank")];
    await seedReferences(dir, items);
    const model = fakeModel(await png(400, 300));
    const args = { ...parseArgs(["--set=ids:push_up,plank", "--model=both", "--max-calls=100", "--budget-usd=5"]), work: dir };
    const ledger = emptyLedger();
    const jobs = planJobs(items, args, ledger);
    assert.equal(jobs.length, 8);
    const { stopped } = await runJobs({ jobs, args, ledger, key: KEY, fetchImpl: model.fetchImpl, sharp, personas, log: () => undefined });
    assert.equal(stopped, null);
    assert.equal(model.requests.length, 8);
    for (const request of model.requests) {
      assert.equal(request.headers["x-goog-api-key"], KEY);
      assert.ok(!request.body.includes(KEY), "the key is never in a body");
      assert.ok(!request.url.includes(KEY), "nor in the URL");
    }
    const parts = model.requests.map((request) => JSON.parse(request.body).contents[0].parts.length);
    assert.deepEqual(parts, [3, 4, 3, 4, 3, 4, 3, 4], "start: prompt, persona, reference; end: also the start frame");
    const saved = readLedger(dir);
    assert.equal(saved.calls, 8);
    assert.equal(saved.spentUsd, 0.312);
    assert.equal(saved.images[jobKey("plank", "female", 1)].status, "generated");
    assert.ok(existsSync(encodedFile(dir, "plank", "female", 1)) && existsSync(rawFile(dir, "plank", "female", 1)));
    assert.equal(saved.images[jobKey("plank", "female", 1)].sha256, sha256(readFileSync(encodedFile(dir, "plank", "female", 1))));
  } finally {
    done();
  }
});

test("the call cap and the budget stop a run before the call that would pass them", async () => {
  const { dir, done } = workDir();
  try {
    const items = [item("push_up"), item("plank")];
    await seedReferences(dir, items);
    const image = await png(400, 300);
    const byCalls = fakeModel(image);
    const capped = { ...parseArgs(["--max-calls=3", "--budget-usd=5"]), work: dir };
    const first = await runJobs({ jobs: planJobs(items, capped, emptyLedger()), args: capped, ledger: emptyLedger(), key: KEY, fetchImpl: byCalls.fetchImpl, sharp, personas, log: () => undefined });
    assert.equal(byCalls.requests.length, 3);
    assert.match(first.stopped, /call cap reached \(3 of 3\)/);

    const byBudget = fakeModel(image);
    const budget = { ...parseArgs(["--max-calls=100", "--budget-usd=0.1"]), work: path.join(dir, "b") };
    await seedReferences(budget.work, items);
    const second = await runJobs({ jobs: planJobs(items, budget, emptyLedger()), args: budget, ledger: emptyLedger(), key: KEY, fetchImpl: byBudget.fetchImpl, sharp, personas, log: () => undefined });
    assert.equal(byBudget.requests.length, 2, "two calls cost US$0.078; a third would pass US$0.10");
    assert.match(second.stopped, /budget reached/);
    assert.equal(stopReason({ calls: 0, spentUsd: 0 }, { maxCalls: 0, budgetUsd: 10, price: 0.039 }), "call cap reached (0 of 0)");
  } finally {
    done();
  }
});

test("resume: a second run carries on from the ledger and never redoes a made frame; failures are retried", async () => {
  const { dir, done } = workDir();
  try {
    const items = [item("push_up")];
    await seedReferences(dir, items);
    const image = await png(400, 300);
    const args = { ...parseArgs(["--model=male", "--max-calls=1", "--budget-usd=5", "--resume"]), work: dir };
    const one = fakeModel(image);
    await runJobs({ jobs: planJobs(items, args, readLedger(dir)), args, ledger: readLedger(dir), key: KEY, fetchImpl: one.fetchImpl, sharp, personas, log: () => undefined });
    assert.equal(one.requests.length, 1);
    const resumed = readLedger(dir);
    const remaining = planJobs(items, args, resumed);
    assert.deepEqual(remaining.map((job) => job.key), ["push_up/male/1"]);
    const more = { ...args, maxCalls: 10 };
    const two = fakeModel(image);
    await runJobs({ jobs: remaining, args: more, ledger: resumed, key: KEY, fetchImpl: two.fetchImpl, sharp, personas, log: () => undefined });
    assert.equal(two.requests.length, 1);
    assert.equal(readLedger(dir).calls, 2);
    const failed = { ...readLedger(dir) };
    failed.images["push_up/male/1"].status = "failed";
    assert.deepEqual(planJobs(items, args, failed).map((job) => job.key), ["push_up/male/1"]);
  } finally {
    done();
  }
});

test("an end frame is never made without a usable start frame, and a failed answer is recorded safely", async () => {
  const { dir, done } = workDir();
  try {
    const items = [item("push_up")];
    await seedReferences(dir, items);
    const args = { ...parseArgs(["--model=female", "--max-calls=10", "--budget-usd=5"]), work: dir };
    const requests = [];
    const failing = async (url, init) => { requests.push(init); return { ok: false, status: 400, text: async () => `bad request for key ${KEY}` }; };
    const ledger = emptyLedger();
    await runJobs({ jobs: planJobs(items, args, ledger), args, ledger, key: KEY, fetchImpl: failing, sharp, personas, log: () => undefined });
    assert.equal(requests.length, 1, "the end frame was skipped");
    const entry = readLedger(dir).images["push_up/female/0"];
    assert.equal(entry.status, "failed");
    assert.ok(!entry.reason.includes(KEY), "the key is masked in the ledger");
    assert.match(entry.reason, /\[key\]/);
  } finally {
    done();
  }
});

test("persona approval: runs refuse unapproved or changed persona sheets", () => {
  const { dir, done } = workDir();
  try {
    assert.match(approvedPersonas(dir, ["male"]).error, /not approved yet/);
    mkdirSync(path.dirname(personaFile(dir, "male")), { recursive: true });
    writeFileSync(personaFile(dir, "male"), "male persona");
    writeFileSync(approvedPersonasFile(dir), JSON.stringify({ male: sha256(Buffer.from("male persona")) }));
    assert.equal(approvedPersonas(dir, ["male"]).parts.male.mimeType, "image/png");
    writeFileSync(personaFile(dir, "male"), "changed");
    assert.match(approvedPersonas(dir, ["male"]).error, /changed after approval/);
  } finally {
    done();
  }
});

test("reference downloads fetch only the pinned Free Exercise DB revision and record size and SHA-256", async () => {
  const { dir, done } = workDir();
  try {
    const fetched = [];
    const bytes = Buffer.from("jpeg bytes");
    const fetchImpl = async (url) => { fetched.push(url); return { ok: true, status: 200, arrayBuffer: async () => bytes }; };
    const ledger = emptyLedger();
    await downloadReferences({ items: [item("push_up", "Pushups"), { id: "jumping_jack", reference: { kind: "fitx", files: ["a", "b"] } }], work: dir, ledger, fetchImpl, log: () => undefined });
    assert.equal(fetched.length, 2);
    assert.deepEqual(ledger.refs["Pushups/0"], { url: fetched[0], bytes: bytes.length, sha256: sha256(bytes) });
    const bad = { id: "x", reference: { kind: "free-exercise-db", ref: "x", files: ["https://example.org/x.jpg", "https://example.org/y.jpg"] } };
    await assert.rejects(downloadReferences({ items: [bad], work: dir, ledger, fetchImpl, log: () => undefined }), /Refusing to fetch/);
    writeLedger(dir, ledger);
    assert.equal(readLedger(dir).refs["Pushups/1"].bytes, bytes.length);
  } finally {
    done();
  }
});
