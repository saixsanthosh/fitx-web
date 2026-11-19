import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_CALLS, MAX_IMAGES, composePrompt, mediaModule, parseArgs, pickImage, readKey, requestBody, retouchBoxes, safeError, validateManifest,
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
