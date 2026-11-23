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
  approvedPersonasFile, sha256, downloadReferences, callCostUsd, CALL_RESERVE_USD, ERROR_CHARGE_USD, IMAGE_PRICES_USD,
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

/** A fake generateContent endpoint: records every request, answers with a small image and its usage counts. */
function fakeModel(image, usage = { promptTokenCount: 1000, candidatesTokenCount: 1290 }, onCall = () => undefined) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, headers: init.headers, body: init.body });
    onCall(init);
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: image.toString("base64") } }] } }], usageMetadata: usage }) };
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
    assert.match(text, /^Edit image 1\. Reproduce exactly the pose in image 1/, "the reference photo is the image being edited");
    assert.match(text, /camera angle, camera height and framing exactly as they are in image 1, with the camera at the same distance/);
    assert.match(text, /how much each elbow, knee and hip is bent, how far the chest, hips and knees are from the floor/);
    assert.match(text, /Change only the person and the background/);
    assert.match(text, /Nothing of the person in image 1 may remain/, "the photo's own person never shows through");
    assert.match(text, /plain matte black with no numbers, letters or markings/, "weights carry no printed numbers");
    assert.match(text, /Do not change, correct, exaggerate or move the pose/);
    assert.doesNotMatch(text, /\b(lower|raise|move) (the|your|their) (arms|body|hips)\b/i);
    assert.doesNotMatch(text, /Image 3/, "no frame is sent a third image (the model copied its pose)");
    assert.doesNotMatch(text, /push up|start position|end position/i, "the prompt names no exercise and no position");
  }
  assert.equal(demoPrompt(item("push_up"), "male", 0), demoPrompt(item("push_up"), "male", 1), "start and end differ only by image 1");
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
    assert.deepEqual(parts, [3, 3, 3, 3, 3, 3, 3, 3], "each frame: prompt, its reference photo, the persona");
    for (const request of model.requests.slice(0, 2)) {
      const sent = JSON.parse(request.body).contents[0].parts;
      assert.equal(sent[1].inline_data.mime_type, "image/jpeg", "image 1 is the reference photo being edited");
      assert.equal(sent[2].inline_data.data, personas.male.data, "image 2 is the persona");
    }
    assert.equal(readLedger(dir).images[jobKey("push_up", "male", 0)].prompt, 6);
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

test("the hard total (D9): calls are charged from their own token counts, the reserve is held back before each call", async () => {
  const model = DEFAULT_IMAGE_MODEL;
  const reserve = CALL_RESERVE_USD[model];
  assert.ok(reserve > IMAGE_PRICES_USD[model]);
  assert.equal(callCostUsd(model, { promptTokenCount: 4400, candidatesTokenCount: 1290 }, { imageReturned: true }), 0.0401, "4,400 in and 1,290 out cost US$0.04002, rounded up");
  assert.equal(callCostUsd(model, { promptTokenCount: 100, candidatesTokenCount: 0 }, { imageReturned: true }), IMAGE_PRICES_USD[model], "an image is never charged less than the image price");
  assert.equal(callCostUsd(model, { promptTokenCount: 3000, candidatesTokenCount: 0 }, { imageReturned: false }), 0.0009, "an answer without an image, by its own counts");
  assert.equal(callCostUsd(model, null, { imageReturned: true }), reserve, "no counts: the reserve");
  assert.equal(callCostUsd(model, { promptTokenCount: 4400, candidatesTokenCount: 1290, thoughtsTokenCount: 100 }, { imageReturned: true }), 0.0431, "thinking tokens count as output");

  const { dir, done } = workDir();
  try {
    const items = [item("push_up"), item("plank")];
    await seedReferences(dir, items);
    const image = await png(400, 300);
    // Each call really costs US$0.0401. A flat US$0.039 check would allow a second call at a US$0.08 budget and end at
    // US$0.0802, past the limit; holding back the reserve stops after one.
    const held = [];
    const dear = fakeModel(image, { promptTokenCount: 4400, candidatesTokenCount: 1290 }, () => held.push(readLedger(dir).spentUsd));
    const args = { ...parseArgs(["--max-calls=100", "--budget-usd=0.08"]), work: dir };
    const run = await runJobs({ jobs: planJobs(items, args, emptyLedger()), args, ledger: emptyLedger(), key: KEY, fetchImpl: dear.fetchImpl, sharp, personas, log: () => undefined });
    assert.equal(dear.requests.length, 1);
    assert.match(run.stopped, /budget reached/);
    assert.deepEqual(held, [reserve], "while the call is out the ledger holds the reserve");
    const saved = readLedger(dir);
    assert.equal(saved.spentUsd, 0.0401);
    assert.ok(saved.spentUsd <= 0.08);
    assert.deepEqual(saved.images[jobKey("push_up", "male", 0)].usage, { input: 4400, output: 1290, thoughts: 0 });
    assert.equal(saved.images[jobKey("push_up", "male", 0)].costUsd, 0.0401);

    // A refused request (not a temporary one), an answer without an image and a lost connection are each charged honestly.
    const answers = [
      async () => ({ ok: false, status: 400, text: async () => "bad request" }),
      async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }], usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 0 } }) }),
      async () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); },
    ];
    const charges = [];
    for (const answer of answers) {
      const work = mkdtempSync(path.join(dir, "c-"));
      await seedReferences(work, items);
      const one = { ...parseArgs(["--model=male", "--max-calls=1", "--budget-usd=1"]), work };
      await runJobs({ jobs: planJobs([items[0]], one, emptyLedger()), args: one, ledger: emptyLedger(), key: KEY, fetchImpl: answer, sharp, personas, log: () => undefined });
      const after = readLedger(work);
      assert.equal(after.images[jobKey("push_up", "male", 0)].status, "failed");
      charges.push(after.spentUsd);
    }
    assert.deepEqual(charges, [ERROR_CHARGE_USD, 0.0009, reserve]);
  } finally {
    done();
  }
});

test("a temporary refusal (503, 429) is asked again after a wait; each refusal is charged the small error charge", async () => {
  const { dir, done } = workDir();
  try {
    const items = [item("push_up")];
    await seedReferences(dir, items);
    const image = await png(400, 300);
    const good = fakeModel(image, { promptTokenCount: 1000, candidatesTokenCount: 1290 });
    const statuses = [503, 429];
    let requests = 0;
    const busyThenGood = async (url, init) => {
      requests += 1;
      const status = statuses.shift();
      if (status) return { ok: false, status, text: async () => "This model is currently experiencing high demand." };
      return good.fetchImpl(url, init);
    };
    const slept = [];
    const args = { ...parseArgs(["--model=male", "--max-calls=10", "--budget-usd=1"]), work: dir };
    await runJobs({ jobs: planJobs(items, args, emptyLedger()).slice(0, 1), args, ledger: emptyLedger(), key: KEY, fetchImpl: busyThenGood, sharp, personas, log: () => undefined, sleep: async (ms) => { slept.push(ms); }, waits: [5, 10, 20] });
    assert.equal(requests, 3);
    assert.deepEqual(slept, [5, 10]);
    const saved = readLedger(dir);
    assert.equal(saved.calls, 1, "one image asked for, however many times it was refused");
    assert.equal(saved.images[jobKey("push_up", "male", 0)].status, "generated");
    assert.equal(saved.images[jobKey("push_up", "male", 0)].refused, 2);
    assert.equal(saved.spentUsd, 0.039 + 2 * ERROR_CHARGE_USD);

    // A refusal that is not temporary (400), or one past the last wait, is not asked again.
    const work = mkdtempSync(path.join(dir, "n-"));
    await seedReferences(work, items);
    let bad = 0;
    const one = { ...args, work };
    await runJobs({ jobs: planJobs(items, one, emptyLedger()).slice(0, 1), args: one, ledger: emptyLedger(), key: KEY, fetchImpl: async () => { bad += 1; return { ok: false, status: 400, text: async () => "bad" }; }, sharp, personas, log: () => undefined, sleep: async () => undefined, waits: [5] });
    assert.equal(bad, 1);
    let busy = 0;
    const two = { ...args, work: mkdtempSync(path.join(dir, "b-")) };
    await seedReferences(two.work, items);
    await runJobs({ jobs: planJobs(items, two, emptyLedger()).slice(0, 1), args: two, ledger: emptyLedger(), key: KEY, fetchImpl: async () => { busy += 1; return { ok: false, status: 503, text: async () => "busy" }; }, sharp, personas, log: () => undefined, sleep: async () => undefined, waits: [5, 5] });
    assert.equal(busy, 3, "the first ask and two more");
    assert.equal(readLedger(two.work).spentUsd, 3 * ERROR_CHARGE_USD);
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
