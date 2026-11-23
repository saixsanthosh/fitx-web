import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  HEX_COLOUR, MAX_CALLS, MAX_IMAGES, composePrompt, mediaModule, parseArgs, pickImage, readKey, requestBody, retouchBoxes, retouchWeight, safeError,
  validateManifest,
} from "./generate-images.mjs";

const manifest = JSON.parse(readFileSync(new URL("./landing.prompts.json", import.meta.url), "utf8"));

test("the landing manifest is valid and inside the brief's caps", () => {
  validateManifest(manifest);
  assert.ok(manifest.images.length <= MAX_IMAGES);
  assert.equal(MAX_IMAGES, 12);
  assert.equal(MAX_CALLS, 24);
  assert.match(manifest.style, /No text/);
});

test("prompts fill the cast and append the shared style; unknown placeholders fail", () => {
  const prompt = composePrompt(manifest, manifest.images.find((image) => image.id === "man-plan"));
  assert.match(prompt, /Indian man/);
  assert.match(prompt, /No text, letters/);
  assert.throws(() => composePrompt(manifest, { id: "x", prompt: "{nobody}" }), /unknown placeholder/);
});

test("the key is read from the env file and never ends up in the request body or an error", () => {
  const key = "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345";
  assert.equal(readKey(`# note\nGEMINI_API_KEY="${key}"\n`), key);
  assert.equal(readKey("OTHER=1"), null);
  assert.equal(readKey("GEMINI_API_KEY="), null);
  const body = JSON.stringify(requestBody("hello", "4:5", { mimeType: "image/png", data: "AAAA" }));
  assert.doesNotMatch(body, /AIza/);
  assert.match(body, /"aspectRatio":"4:5"/);
  assert.match(body, /"responseModalities":\["IMAGE"\]/);
  assert.equal(safeError(`bad key ${key} rejected`, key), "bad key [key] rejected");
  assert.doesNotMatch(safeError(`leak ${key}`), /AIza/);
});

test("answers without an image are reported, not saved", () => {
  assert.deepEqual(pickImage({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QQ==" } }] } }] }), { mimeType: "image/png", data: "QQ==" });
  assert.deepEqual(pickImage({ candidates: [{ finishReason: "NO_IMAGE", content: { parts: [{ text: "sorry" }] } }] }), { error: "NO_IMAGE" });
  assert.deepEqual(pickImage({ promptFeedback: { blockReason: "SAFETY" } }), { error: "SAFETY" });
});

test("arguments, manifest checks, retouch boxes and the generated module", () => {
  assert.deepEqual(parseArgs(["--set=landing", "--only=a,b", "--dry-run"]), { set: "landing", only: ["a", "b"], dryRun: true, encodeOnly: false, raw: null });
  assert.throws(() => parseArgs([]), /--set/);
  assert.throws(() => parseArgs(["--set=../x"]), /--set/);
  assert.throws(() => validateManifest({ images: [{ id: "a", prompt: "p", alt: "a", aspect: "1:1", ref: "b" }] }), /must come earlier/);
  assert.deepEqual(retouchBoxes(100, 100, [{ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }]), [{ left: 90, top: 90, width: 10, height: 10, sigma: 12 }]);
  const source = mediaModule("landing", [{ id: "hero", src: "/media/landing/hero.webp", width: 10, height: 5, alt: "A", blurDataURL: "data:image/webp;base64,AA" }]);
  assert.match(source, /export const LANDING_MEDIA = \{/);
  assert.match(source, /export type LandingMediaId = keyof typeof LANDING_MEDIA;/);
});

test("no prompt names a hex colour code, so the model cannot print one on a picture", () => {
  const image = { id: "a", alt: "a", aspect: "1:1", prompt: "A bench" };
  assert.throws(() => validateManifest({ style: "Accent terracotta (#C44933).", images: [image] }), /hex colour/);
  assert.throws(() => validateManifest({ style: "Plain.", images: [{ ...image, prompt: "A backdrop (#d8d3cc)" }] }), /hex colour/);
  assert.doesNotThrow(() => validateManifest({ style: "A single terracotta accent.", images: [image] }));
  const sets = readdirSync(new URL(".", import.meta.url)).filter((name) => name.endsWith(".prompts.json"));
  assert.ok(sets.length >= 10);
  for (const name of sets) {
    const set = JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
    assert.doesNotMatch(set.style ?? "", HEX_COLOUR, name);
    for (const entry of set.images) assert.doesNotMatch(entry.prompt, HEX_COLOUR, `${name} ${entry.id}`);
  }
});

test("retouch boxes can copy a clean patch and fade it in, inside a rectangle or an ellipse", () => {
  const [box] = retouchBoxes(200, 100, [{ x: 0.5, y: 0.5, w: 0.1, h: 0.2, from: { x: 0.98, y: 0.1 }, feather: 2, ellipse: true }]);
  // The source corner is pulled back inside the frame so the whole patch can be read.
  assert.deepEqual(box, { left: 100, top: 50, width: 20, height: 20, sigma: 12, from: { left: 180, top: 10 }, feather: 2, ellipse: true });
  assert.equal(retouchWeight(box, 110, 60), 1, "the centre is fully patched");
  assert.equal(retouchWeight(box, 100, 50), 0, "the corner lies outside the ellipse");
  assert.ok(retouchWeight(box, 110, 50) > 0 && retouchWeight(box, 110, 50) < 1, "the edge fades");
  const rect = { left: 10, top: 10, width: 10, height: 4 };
  assert.equal(retouchWeight(rect, 10, 10), 1, "no feather: a hard-edged patch");
  assert.equal(retouchWeight(rect, 20, 10), 0);
  assert.equal(retouchWeight({ ...rect, feather: 2 }, 10, 11), 0.25);
  assert.equal(retouchWeight({ ...rect, feather: 2 }, 12, 11), 0.75);
});

test("every committed photo the image review flagged carries its retouch or its new prompt", () => {
  const load = (name) => JSON.parse(readFileSync(new URL(`./${name}.prompts.json`, import.meta.url), "utf8"));
  const find = (name, id) => load(name).images.find((entry) => entry.id === id);
  assert.equal(find("onboarding", "stage").retouch[0].from !== undefined, true, "the bench rail's printed code is patched over");
  assert.ok(find("workout-modes", "home").retouch.length);
  assert.ok(find("workout-modes", "ez-bar").retouch.length);
  assert.ok(find("explore", "gym-workouts").retouch.length);
  const smith = find("equipment", "smith-machine").prompt;
  assert.match(smith, /guide rods/);
  assert.match(smith, /no J-hooks/);
});
